"""
媒体生成相关 API（图像 / 视频）
"""
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, BackgroundTasks
import asyncio
import base64
import re
import time
import uuid
from io import BytesIO
from pathlib import Path
from typing import List, Literal, Optional
from PIL import Image
from pydantic import BaseModel

from server.ai_draw_service import AIDrawService, get_ai_draw_service
from server.image_upscale_methods import build_upscale_method_registry
from server.schemas import GenerateMediaRequest, GenerateMediaResponse
from utils.config_loader import get_config, get_image_upscale_config, get_video_frames_config
from utils.media_processor import ImageUpscaleValidationError, decode_upscale_png_data_url, upscale_image_lanczos
from utils.video_frames import (
    BackgroundRemovalOptions,
    apply_background_removal,
    build_apng,
    build_gif,
    build_spritesheet,
    extract_frame_items,
    normalize_frame_sizes,
    probe_video_duration,
    probe_video_fps,
    resize_frames,
    video_to_spritesheet,
    zip_frames,
)

router = APIRouter(prefix="/media", tags=["媒体生成"])


class BackgroundOptionsRequest(BaseModel):
    """视频帧背景处理参数"""
    background_mode: Optional[Literal['none', 'ai', 'inspyrenet', 'birefnet', 'edge']] = None
    rembg_model: Optional[str] = None
    alpha_matting: Optional[bool] = None
    alpha_matting_foreground_threshold: Optional[int] = None
    alpha_matting_background_threshold: Optional[int] = None
    alpha_matting_erode_size: Optional[int] = None
    post_process_mask: Optional[bool] = None
    inspyrenet_mode: Optional[Literal['base', 'fast', 'base-nightly']] = None
    inspyrenet_resize: Optional[Literal['static', 'dynamic']] = None
    birefnet_model: Optional[str] = None
    birefnet_image_size: Optional[int] = None
    birefnet_device: Optional[str] = None
    birefnet_precision: Optional[Literal['auto', 'fp32', 'fp16', 'bf16']] = None
    edge_threshold: Optional[int] = None
    edge_feather: Optional[int] = None


class VideoToSpritesheetRequest(BackgroundOptionsRequest):
    """视频转透明精灵图请求"""
    video_url: str            # 形如 /uploads/video/xxx.mp4
    rows: int = 1
    start_time: Optional[float] = None
    end_time: Optional[float] = None


class VideoFramePreviewRequest(BaseModel):
    """视频抽帧预览请求"""
    video_url: str
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    fps: Optional[float] = None
    max_frames: Optional[int] = None


class VideoMetaRequest(BaseModel):
    """视频元信息探测请求（仅 ffprobe，不抽帧）"""
    video_url: str


class VideoFrameExportRequest(BaseModel):
    """抽帧工作台导出请求"""
    frame_urls: List[str]
    output: Literal['zip', 'spritesheet', 'gif', 'apng'] = 'spritesheet'
    rows: int = 1
    cell_width: Optional[int] = None
    cell_height: Optional[int] = None
    gif_fps: Optional[float] = None
    filename: Optional[str] = None
    name_template: Optional[str] = None
    progress_id: Optional[str] = None


class VideoFrameBackgroundBatchRequest(BackgroundOptionsRequest):
    """批量帧背景处理请求"""
    frame_urls: List[str]


class SaveEditedVideoFrameRequest(BaseModel):
    """保存 canvas 编辑后的 PNG。"""
    image: str
    base_frame_url: Optional[str] = None
    preview_id: Optional[str] = None


class ImageUpscaleRequest(BaseModel):
    """对当前 canvas PNG 执行精确倍率放大。"""
    image: str
    method: Literal['lanczos', 'apisr', 'real_cugan', 'realesrgan_general', 'realesrgan_anime', 'invsr']
    scale: Literal[2, 4]


class ImageUpscaleBatchRequest(BaseModel):
    """使用同一方法批量放大工作集图片。"""
    frame_urls: List[str]
    method: Literal['lanczos', 'apisr', 'real_cugan', 'realesrgan_general', 'realesrgan_anime', 'invsr']
    scale: Literal[2, 4]


class RemoveBackgroundRequest(BackgroundOptionsRequest):
    """单图移除背景请求"""
    image_url: str


def _resolve_upload_path(upload_url: str, label: str = '文件') -> Path:
    """将 /uploads/... URL 解析为本地绝对路径，并校验位于上传目录内（防目录穿越）。"""
    prefix = '/uploads/'
    rel = upload_url[len(prefix):] if upload_url.startswith(prefix) else (
        upload_url[len('uploads/'):] if upload_url.startswith('uploads/') else None
    )
    if not rel or '..' in Path(rel).parts:
        raise HTTPException(status_code=400, detail='仅支持 /uploads 下的文件')

    base = Path(get_config().paths.upload_dir).resolve()
    local_path = (base / rel).resolve()
    if not local_path.is_relative_to(base):
        raise HTTPException(status_code=400, detail='非法文件路径')
    if not local_path.exists():
        raise HTTPException(status_code=400, detail=f'{label}不存在')
    return local_path


def _background_options(request: BackgroundOptionsRequest, fallback_mode: str = 'ai') -> BackgroundRemovalOptions:
    cfg = get_video_frames_config()
    mode = request.background_mode or fallback_mode
    if mode not in {'none', 'ai', 'inspyrenet', 'birefnet', 'edge'}:
        mode = 'ai'
    return BackgroundRemovalOptions(
        mode=mode,
        rembg_model=request.rembg_model or cfg.rembg_model,
        alpha_matting=cfg.alpha_matting if request.alpha_matting is None else request.alpha_matting,
        alpha_matting_foreground_threshold=(
            cfg.alpha_matting_foreground_threshold
            if request.alpha_matting_foreground_threshold is None
            else request.alpha_matting_foreground_threshold
        ),
        alpha_matting_background_threshold=(
            cfg.alpha_matting_background_threshold
            if request.alpha_matting_background_threshold is None
            else request.alpha_matting_background_threshold
        ),
        alpha_matting_erode_size=(
            cfg.alpha_matting_erode_size
            if request.alpha_matting_erode_size is None
            else request.alpha_matting_erode_size
        ),
        post_process_mask=cfg.post_process_mask if request.post_process_mask is None else request.post_process_mask,
        inspyrenet_mode=cfg.inspyrenet_mode if request.inspyrenet_mode is None else request.inspyrenet_mode,
        inspyrenet_resize=cfg.inspyrenet_resize if request.inspyrenet_resize is None else request.inspyrenet_resize,
        birefnet_model=cfg.birefnet_model if request.birefnet_model is None else request.birefnet_model,
        birefnet_image_size=cfg.birefnet_image_size if request.birefnet_image_size is None else request.birefnet_image_size,
        birefnet_device=cfg.birefnet_device if request.birefnet_device is None else request.birefnet_device,
        birefnet_precision=cfg.birefnet_precision if request.birefnet_precision is None else request.birefnet_precision,
        edge_threshold=cfg.edge_threshold if request.edge_threshold is None else request.edge_threshold,
        edge_feather=cfg.edge_feather if request.edge_feather is None else request.edge_feather,
    )


def _load_frame_urls(frame_urls: List[str], mode: str = 'RGBA') -> List[Image.Image]:
    if not frame_urls:
        raise HTTPException(status_code=400, detail='请至少选择一帧')
    if len(frame_urls) > 600:
        raise HTTPException(status_code=400, detail='一次最多导出 600 帧')

    frames: List[Image.Image] = []
    for url in frame_urls:
        frame_path = _resolve_upload_path(url, label='帧文件')
        try:
            with Image.open(frame_path) as img:
                frames.append(img.convert(mode))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f'帧文件读取失败: {e}')
    return frames


def _safe_export_dimension(value: Optional[int]) -> Optional[int]:
    if value is None:
        return None
    return max(1, min(int(value), 4096))


def _safe_time_range(start: Optional[float], end: Optional[float]) -> tuple[Optional[float], Optional[float]]:
    safe_start = max(0, float(start)) if start is not None else None
    safe_end = max(0, float(end)) if end is not None else None
    if safe_start is not None and safe_end is not None and safe_end <= safe_start:
        raise HTTPException(status_code=400, detail='结束时间必须大于开始时间')
    if safe_start is None and safe_end == 0:
        safe_end = None
    return safe_start, safe_end


def _safe_filename_stem(value: Optional[str], fallback: str) -> str:
    stem = (value or fallback).strip()
    stem = re.sub(r'[\\/:*?"<>|\s]+', '_', stem)
    stem = re.sub(r'_+', '_', stem).strip('._')
    return stem[:80] or fallback


def _decode_data_png(data_url: str) -> Image.Image:
    if ',' not in data_url or not data_url.startswith('data:image/png;base64,'):
        raise HTTPException(status_code=400, detail='仅支持 PNG data URL')
    try:
        raw = base64.b64decode(data_url.split(',', 1)[1], validate=True)
        image = Image.open(BytesIO(raw)).convert('RGBA')
    except Exception as e:
        raise HTTPException(status_code=400, detail=f'PNG 解码失败: {e}')
    return image


def _encode_png_data_url(image: Image.Image) -> str:
    buffer = BytesIO()
    image.convert('RGBA').save(buffer, format='PNG')
    return f"data:image/png;base64,{base64.b64encode(buffer.getvalue()).decode('ascii')}"


def _decode_upscale_png(data_url: str, scale: int, processing_scale: int) -> tuple[Image.Image, int, int]:
    cfg = get_image_upscale_config()
    try:
        return decode_upscale_png_data_url(
            data_url,
            scale,
            cfg.max_edge,
            cfg.max_pixels,
            cfg.max_input_bytes,
            processing_scale,
        )
    except ImageUpscaleValidationError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


def _cleanup_stale_upscale_previews(save_dir: Path) -> None:
    cutoff = time.time() - 24 * 60 * 60
    for path in save_dir.glob('upscaled_*.png'):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
        except OSError:
            pass


def _comfy_option_values(node_info: dict, input_name: str) -> set:
    try:
        field = node_info['input']['required'][input_name]
    except (KeyError, TypeError):
        return set()
    if not isinstance(field, list) or not field:
        return set()
    if isinstance(field[0], list):
        return set(field[0])
    if len(field) > 1 and isinstance(field[1], dict):
        return set(field[1].get('options', []))
    return set()


def _invsr_config_error(loader_info: dict, sampler_info: dict, cfg) -> Optional[str]:
    if not loader_info or not sampler_info:
        return 'ComfyUI 未安装 InvSR 节点'
    required_options = {
        'sd_model': cfg.invsr_sd_model,
        'invsr_model': cfg.invsr_model,
        'dtype': cfg.invsr_dtype,
    }
    for input_name, value in required_options.items():
        if value not in _comfy_option_values(loader_info, input_name):
            return f'InvSR 节点不支持 {input_name}={value}'
    if cfg.invsr_chopping_size not in _comfy_option_values(sampler_info, 'chopping_size'):
        return f'InvSR 节点不支持 chopping_size={cfg.invsr_chopping_size}'
    return None


_export_progress: dict[str, dict] = {}
_upscale_slots = asyncio.Semaphore(1)


def _set_export_progress(
    progress_id: Optional[str],
    stage: str,
    percent: int,
    message: str,
    current: Optional[int] = None,
    total: Optional[int] = None,
    done: bool = False,
    error: Optional[str] = None,
) -> None:
    if not progress_id:
        return
    _export_progress[progress_id] = {
        'progress_id': progress_id,
        'stage': stage,
        'percent': max(0, min(100, percent)),
        'message': message,
        'current': current,
        'total': total,
        'done': done,
        'error': error,
    }


@router.post("/generate", response_model=GenerateMediaResponse)
async def generate_media(
    request: GenerateMediaRequest,
    background_tasks: BackgroundTasks,
    service: AIDrawService = Depends(get_ai_draw_service)
) -> GenerateMediaResponse:
    """生成媒体 - 使用用户选择的工作流（立即返回，结果通过 WebSocket 推送）"""

    async def _run_generation():
        try:
            await service.generate_media(
                prompt=request.prompt,
                workflow=request.workflow,
                strength=request.strength if request.strength is not None else 1,
                lora_prompt=request.lora_prompt,
                count=request.count,
                reference_image=request.reference_image,
                reference_image_2=request.reference_image_2,
                reference_image_3=request.reference_image_3,
                width=request.width,
                height=request.height,
                prompt_end=request.prompt_end,
                reference_image_end=request.reference_image_end,
                use_original_size=request.use_original_size,
                is_loop=request.is_loop,
                start_frame_count=request.start_frame_count,
                end_frame_count=request.end_frame_count,
                frame_rate=request.frame_rate,
                frame_count=request.frame_count,
                send_history=request.send_history,
                session_id=request.session_id,
                action=request.action,
                view=request.view,
                direction=request.direction,
                kling_options=request.kling_options,
            )
        except Exception as e:
            # 通过 WebSocket 推送错误信息
            service._notify_state_change('error', str(e))
            # 重置生成状态
            service.is_generating = False
            service._notify_state_change('is_generating', False)

    background_tasks.add_task(_run_generation)
    return GenerateMediaResponse(count=0, images=[])


@router.post("/upload-reference")
async def upload_reference_media(file: UploadFile = File(...)) -> dict:
    """上传参考图"""
    try:
        contents = await file.read()
        image = Image.open(BytesIO(contents))
        if image.mode != 'RGB':
            image = image.convert('RGB')
        buffered = BytesIO()
        image.save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode()
        return {
            "success": True,
            "image": f"data:image/png;base64,{img_str}"
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"图片处理失败: {str(e)}")


@router.get("/stop")
async def stop_generation(service: AIDrawService = Depends(get_ai_draw_service)) -> dict:
    """停止生成"""
    service.stop_generation()
    return {"success": True, "message": "已停止生成"}


@router.post("/video-to-spritesheet")
async def to_spritesheet(request: VideoToSpritesheetRequest) -> dict:
    """视频 → 透明精灵图（单张网格 PNG）。ffmpeg 抽帧 + rembg 逐帧抠图。"""
    video_path = _resolve_upload_path(request.video_url, label='视频')
    cfg = get_video_frames_config()
    bg_options = _background_options(request, fallback_mode=cfg.background_mode)
    start_time, end_time = _safe_time_range(request.start_time, request.end_time)

    try:
        png_bytes, meta = await asyncio.to_thread(
            video_to_spritesheet,
            video_path,
            rows=request.rows,
            max_frames=cfg.max_frames,
            start_time=start_time,
            end_time=end_time,
            model=cfg.rembg_model,
            background_options=bg_options,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'精灵图生成失败: {e}')

    save_dir = Path(get_config().paths.upload_dir) / 'spritesheet'
    save_dir.mkdir(parents=True, exist_ok=True)
    filename = f'sheet_{uuid.uuid4().hex}.png'
    (save_dir / filename).write_bytes(png_bytes)

    return {
        'success': True,
        'spritesheet_url': f'/uploads/spritesheet/{filename}',
        'frames': meta['frames'],
        'cols': meta['cols'],
        'rows': meta['rows'],
        'background_mode': bg_options.mode,
    }


@router.post("/video-frame-preview")
async def preview_video_frames(request: VideoFramePreviewRequest) -> dict:
    """视频 → 原始预览帧。供工作台第 1 步抽取原始帧。"""
    video_path = _resolve_upload_path(request.video_url, label='视频')
    cfg = get_video_frames_config()
    max_frames = request.max_frames or cfg.max_frames
    max_frames = max(1, min(max_frames, 600))
    source_fps = await asyncio.to_thread(probe_video_fps, video_path)
    source_duration = await asyncio.to_thread(probe_video_duration, video_path)
    start_time, end_time = _safe_time_range(request.start_time, request.end_time)

    try:
        frame_items_raw = await asyncio.to_thread(
            extract_frame_items,
            video_path,
            max_frames=max_frames,
            fps=request.fps,
            start_time=start_time,
            end_time=end_time,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'预览帧抽取失败: {e}')

    if not frame_items_raw:
        raise HTTPException(status_code=500, detail='未抽取到任何预览帧')

    preview_id = f'preview_{uuid.uuid4().hex}'
    save_dir = Path(get_config().paths.upload_dir) / 'frames' / 'previews' / preview_id
    save_dir.mkdir(parents=True, exist_ok=True)

    frame_items = []
    for i, item in enumerate(frame_items_raw):
        filename = f'frame_{i + 1:04d}.png'
        item.image.save(save_dir / filename, format='PNG')
        frame_items.append({
            'index': i,
            'url': f'/uploads/frames/previews/{preview_id}/{filename}',
            'width': item.image.width,
            'height': item.image.height,
            'time': item.time,
        })

    return {
        'success': True,
        'preview_id': preview_id,
        'frames': frame_items,
        'width': frame_items_raw[0].image.width,
        'height': frame_items_raw[0].image.height,
        'source_fps': source_fps,
        'source_duration': source_duration,
    }


@router.post("/video-meta")
async def probe_video_meta(request: VideoMetaRequest) -> dict:
    """探测视频帧率与时长（ffprobe），不抽帧。供工作台默认帧率使用。"""
    video_path = _resolve_upload_path(request.video_url, label='视频')
    source_fps = await asyncio.to_thread(probe_video_fps, video_path)
    source_duration = await asyncio.to_thread(probe_video_duration, video_path)
    return {
        'success': True,
        'source_fps': source_fps,
        'source_duration': source_duration,
    }


@router.post("/video-frame-backgrounds")
async def remove_video_frame_backgrounds(request: VideoFrameBackgroundBatchRequest) -> dict:
    """批量帧移除背景，结果写入透明 PNG，供工作台第 2 步使用。"""
    frames = _load_frame_urls(request.frame_urls, mode='RGB')
    cfg = get_video_frames_config()
    bg_options = _background_options(request, fallback_mode=cfg.background_mode)

    try:
        processed = await asyncio.to_thread(apply_background_removal, frames, bg_options)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'批量移除背景失败: {e}')

    save_dir = Path(get_config().paths.upload_dir) / 'transparent'
    save_dir.mkdir(parents=True, exist_ok=True)
    items = []
    for i, (source_url, result) in enumerate(zip(request.frame_urls, processed), start=1):
        filename = f'frame_transparent_{uuid.uuid4().hex}_{i:04d}.png'
        try:
            result.convert('RGBA').save(save_dir / filename, format='PNG')
        except Exception as e:
            raise HTTPException(status_code=500, detail=f'保存透明帧失败: {e}')
        items.append({
            'source_url': source_url,
            'image_url': f'/uploads/transparent/{filename}',
        })

    return {
        'success': True,
        'background_mode': bg_options.mode,
        'frames': items,
    }


@router.post("/video-frame-edited")
async def save_edited_video_frame(request: SaveEditedVideoFrameRequest) -> dict:
    """保存 canvas 编辑后的 PNG，返回可用于导出的上传 URL。"""
    if request.base_frame_url:
        _resolve_upload_path(request.base_frame_url, label='基础帧')
    image = _decode_data_png(request.image)
    save_dir = Path(get_config().paths.upload_dir) / 'frames' / 'edited'
    save_dir.mkdir(parents=True, exist_ok=True)
    filename = f'edited_{uuid.uuid4().hex}.png'
    try:
        image.save(save_dir / filename, format='PNG')
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'保存编辑帧失败: {e}')
    return {
        'success': True,
        'image_url': f'/uploads/frames/edited/{filename}',
        'width': image.width,
        'height': image.height,
    }


@router.get("/image-upscale-methods")
async def get_image_upscale_methods(
    service: AIDrawService = Depends(get_ai_draw_service),
) -> dict:
    """返回本地方法与远端 ComfyUI 模型可用性。"""
    cfg = get_image_upscale_config()
    try:
        installed_models = set(await service.get_upscale_models())
        model_error = None
    except Exception:
        installed_models = set()
        model_error = 'ComfyUI 当前不可用'
    try:
        invsr_loader, invsr_sampler = await asyncio.gather(
            service.get_comfyui_object_info('LoadInvSRModels'),
            service.get_comfyui_object_info('InvSRSampler'),
        )
        invsr_error = _invsr_config_error(invsr_loader, invsr_sampler, cfg)
        invsr_available = invsr_error is None
    except Exception:
        invsr_available = False
        invsr_error = 'ComfyUI 当前不可用'
    registry = build_upscale_method_registry(cfg)
    return {
        'methods': [
            method.availability(installed_models, invsr_available, model_error, invsr_error)
            for method in registry.values()
        ],
        'scales': [2, 4],
        'max_edge': cfg.max_edge,
        'max_pixels': cfg.max_pixels,
    }


async def _perform_image_upscale(
    request: ImageUpscaleRequest,
    service: AIDrawService,
    persistent: bool = False,
) -> dict:
    cfg = get_image_upscale_config()
    method = build_upscale_method_registry(cfg)[request.method]
    model = method.models.get(request.scale)
    processing_scale = request.scale

    if method.runner == 'upscale_model':
        if model is None:
            raise HTTPException(status_code=400, detail='该算法不支持此倍率')
        try:
            installed_models = set(await service.get_upscale_models())
        except Exception as e:
            raise HTTPException(status_code=503, detail=f'无法连接 ComfyUI: {e}')
        if model.filename not in installed_models:
            raise HTTPException(status_code=503, detail=f'ComfyUI 未安装 {model.filename}')
        processing_scale = model.native_scale
    elif method.runner == 'invsr':
        try:
            invsr_loader, invsr_sampler = await asyncio.gather(
                service.get_comfyui_object_info('LoadInvSRModels'),
                service.get_comfyui_object_info('InvSRSampler'),
            )
        except Exception as e:
            raise HTTPException(status_code=503, detail=f'无法连接 ComfyUI: {e}')
        invsr_error = _invsr_config_error(invsr_loader, invsr_sampler, cfg)
        if invsr_error:
            raise HTTPException(status_code=503, detail=invsr_error)
        processing_scale = 4

    image, width, height = await asyncio.to_thread(
        _decode_upscale_png,
        request.image,
        request.scale,
        processing_scale,
    )

    if method.runner == 'local':
        try:
            result = await asyncio.to_thread(upscale_image_lanczos, image, request.scale)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f'快速放大失败: {e}')
    elif method.runner == 'upscale_model':
        try:
            result = await service.upscale_image(image, model.filename, request.scale, model.native_scale)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f'AI 放大失败: {e}')
    else:
        try:
            result = await service.upscale_image_invsr(
                image,
                request.scale,
                cfg.invsr_sd_model,
                cfg.invsr_model,
                cfg.invsr_dtype,
                cfg.invsr_chopping_size,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f'InvSR 放大失败: {e}')

    relative_dir = 'frames/edited' if persistent else 'upscaled'
    save_dir = Path(get_config().paths.upload_dir) / relative_dir
    save_dir.mkdir(parents=True, exist_ok=True)
    if not persistent:
        await asyncio.to_thread(_cleanup_stale_upscale_previews, save_dir)
    filename = f"{'edited_upscaled' if persistent else 'upscaled'}_{uuid.uuid4().hex}.png"
    try:
        await asyncio.to_thread(result.save, save_dir / filename, 'PNG')
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'保存放大图片失败: {e}')
    return {
        'success': True,
        'image_url': f'/uploads/{relative_dir}/{filename}',
        'width': width,
        'height': height,
        'method': request.method,
        'algorithm': method.algorithm_name,
        'scale': request.scale,
    }


@router.post("/image-upscale")
async def upscale_image(
    request: ImageUpscaleRequest,
    service: AIDrawService = Depends(get_ai_draw_service),
) -> dict:
    """放大当前画布并返回临时上传 URL；繁忙时不排队，避免请求堆积。"""
    try:
        await asyncio.wait_for(_upscale_slots.acquire(), timeout=0.01)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=429, detail='已有放大任务正在处理，请稍后重试')
    try:
        return await _perform_image_upscale(request, service)
    finally:
        _upscale_slots.release()


@router.post("/image-upscale-batch")
async def upscale_image_batch(
    request: ImageUpscaleBatchRequest,
    service: AIDrawService = Depends(get_ai_draw_service),
) -> dict:
    """按顺序放大整个工作集，结果持久化为可直接导出的编辑帧。"""
    try:
        await asyncio.wait_for(_upscale_slots.acquire(), timeout=0.01)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=429, detail='已有放大任务正在处理，请稍后重试')
    try:
        source_frames = _load_frame_urls(request.frame_urls, mode='RGBA')
        results = []
        for source_url, source_frame in zip(request.frame_urls, source_frames):
            item_request = ImageUpscaleRequest(
                image=await asyncio.to_thread(_encode_png_data_url, source_frame),
                method=request.method,
                scale=request.scale,
            )
            result = await _perform_image_upscale(item_request, service, persistent=True)
            results.append({
                'source_url': source_url,
                'image_url': result['image_url'],
                'width': result['width'],
                'height': result['height'],
            })
        return {
            'success': True,
            'method': request.method,
            'scale': request.scale,
            'frames': results,
        }
    finally:
        _upscale_slots.release()


@router.post("/export-video-frames")
async def export_video_frames(request: VideoFrameExportRequest) -> dict:
    """按工作台最终帧 URL 导出 ZIP、精灵图、GIF 或兼容 APNG。"""
    _set_export_progress(request.progress_id, 'reading', 5, '正在读取工作集帧')
    processed = _load_frame_urls(request.frame_urls, mode='RGBA')
    _set_export_progress(request.progress_id, 'reading', 18, f'已读取 {len(processed)} 帧', len(processed), len(processed))

    cell_width = _safe_export_dimension(request.cell_width)
    cell_height = _safe_export_dimension(request.cell_height)
    if cell_width or cell_height:
        _set_export_progress(request.progress_id, 'resize', 40, '正在调整帧尺寸')
        processed = await asyncio.to_thread(resize_frames, processed, cell_width, cell_height)
    elif request.output != 'zip' and len({frame.size for frame in processed}) > 1:
        _set_export_progress(request.progress_id, 'resize', 40, '正在适配不同帧尺寸')
        processed = await asyncio.to_thread(normalize_frame_sizes, processed)

    frame_width = processed[0].width
    frame_height = processed[0].height
    safe_stem = _safe_filename_stem(request.filename, 'video_frames')

    if request.output == 'zip':
        try:
            _set_export_progress(request.progress_id, 'packing', 72, '正在生成 ZIP')
            zip_bytes = await asyncio.to_thread(zip_frames, processed, request.name_template or '{n:03}')
        except Exception as e:
            _set_export_progress(request.progress_id, 'error', 100, 'ZIP 生成失败', error=str(e), done=True)
            raise HTTPException(status_code=500, detail=f'ZIP 生成失败: {e}')
        save_dir = Path(get_config().paths.upload_dir) / 'frames'
        save_dir.mkdir(parents=True, exist_ok=True)
        filename = f'{safe_stem}_{uuid.uuid4().hex}.zip'
        (save_dir / filename).write_bytes(zip_bytes)
        _set_export_progress(request.progress_id, 'done', 100, 'ZIP 已生成', len(processed), len(processed), done=True)
        return {
            'success': True,
            'output': 'zip',
            'zip_url': f'/uploads/frames/{filename}',
            'frames': len(processed),
            'width': frame_width,
            'height': frame_height,
        }

    if request.output == 'gif':
        try:
            _set_export_progress(request.progress_id, 'packing', 72, '正在生成 GIF')
            gif_bytes, duration_ms = await asyncio.to_thread(build_gif, processed, request.gif_fps)
        except Exception as e:
            _set_export_progress(request.progress_id, 'error', 100, 'GIF 生成失败', error=str(e), done=True)
            raise HTTPException(status_code=500, detail=f'GIF 生成失败: {e}')
        save_dir = Path(get_config().paths.upload_dir) / 'gif'
        save_dir.mkdir(parents=True, exist_ok=True)
        filename = f'{safe_stem}_{uuid.uuid4().hex}.gif'
        (save_dir / filename).write_bytes(gif_bytes)
        _set_export_progress(request.progress_id, 'done', 100, 'GIF 已生成', len(processed), len(processed), done=True)
        return {
            'success': True,
            'output': 'gif',
            'gif_url': f'/uploads/gif/{filename}',
            'frames': len(processed),
            'width': frame_width,
            'height': frame_height,
            'duration_ms': duration_ms,
        }

    if request.output == 'apng':
        try:
            _set_export_progress(request.progress_id, 'packing', 72, '正在生成 APNG')
            apng_bytes, duration_ms = await asyncio.to_thread(build_apng, processed, request.gif_fps)
        except Exception as e:
            _set_export_progress(request.progress_id, 'error', 100, 'APNG 生成失败', error=str(e), done=True)
            raise HTTPException(status_code=500, detail=f'APNG 生成失败: {e}')
        save_dir = Path(get_config().paths.upload_dir) / 'apng'
        save_dir.mkdir(parents=True, exist_ok=True)
        filename = f'{safe_stem}_{uuid.uuid4().hex}.png'
        (save_dir / filename).write_bytes(apng_bytes)
        _set_export_progress(request.progress_id, 'done', 100, 'APNG 已生成', len(processed), len(processed), done=True)
        return {
            'success': True,
            'output': 'apng',
            'apng_url': f'/uploads/apng/{filename}',
            'frames': len(processed),
            'width': frame_width,
            'height': frame_height,
            'duration_ms': duration_ms,
        }

    try:
        _set_export_progress(request.progress_id, 'packing', 72, '正在生成精灵图')
        png_bytes, cols, rows = await asyncio.to_thread(build_spritesheet, processed, request.rows)
    except Exception as e:
        _set_export_progress(request.progress_id, 'error', 100, '精灵图生成失败', error=str(e), done=True)
        raise HTTPException(status_code=500, detail=f'精灵图生成失败: {e}')

    save_dir = Path(get_config().paths.upload_dir) / 'spritesheet'
    save_dir.mkdir(parents=True, exist_ok=True)
    filename = f'{safe_stem}_{uuid.uuid4().hex}.png'
    (save_dir / filename).write_bytes(png_bytes)
    _set_export_progress(request.progress_id, 'done', 100, '精灵图已生成', len(processed), len(processed), done=True)
    return {
        'success': True,
        'output': 'spritesheet',
        'spritesheet_url': f'/uploads/spritesheet/{filename}',
        'frames': len(processed),
        'cols': cols,
        'rows': rows,
        'width': frame_width,
        'height': frame_height,
        'sheet_width': cols * frame_width,
        'sheet_height': rows * frame_height,
    }


@router.get("/export-progress/{progress_id}")
async def get_export_progress(progress_id: str) -> dict:
    """查询抽帧导出进度。"""
    return _export_progress.get(progress_id, {
        'progress_id': progress_id,
        'stage': 'waiting',
        'percent': 0,
        'message': '等待导出开始',
        'current': None,
        'total': None,
        'done': False,
        'error': None,
    })


@router.post("/remove-background")
async def remove_background(request: RemoveBackgroundRequest) -> dict:
    """单图移除背景 → 透明 PNG。复用视频抽帧那套 apply_background_removal 抠图逻辑。"""
    image_path = _resolve_upload_path(request.image_url, label='图片')
    cfg = get_video_frames_config()
    bg_options = _background_options(request, fallback_mode=cfg.background_mode)

    try:
        with Image.open(image_path) as img:
            frame = img.convert('RGB')
        [result] = await asyncio.to_thread(apply_background_removal, [frame], bg_options)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'移除背景失败: {e}')

    save_dir = Path(get_config().paths.upload_dir) / 'transparent'
    save_dir.mkdir(parents=True, exist_ok=True)
    filename = f'transparent_{uuid.uuid4().hex}.png'
    try:
        result.convert('RGBA').save(save_dir / filename, format='PNG')
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'保存透明图失败: {e}')

    return {
        'success': True,
        'image_url': f'/uploads/transparent/{filename}',
        'background_mode': bg_options.mode,
    }
