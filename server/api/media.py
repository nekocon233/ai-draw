"""
媒体生成相关 API（图像 / 视频）
"""
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, BackgroundTasks
import asyncio
import base64
import uuid
from io import BytesIO
from pathlib import Path
from typing import List, Literal, Optional
from PIL import Image
from pydantic import BaseModel

from server.ai_draw_service import AIDrawService, get_ai_draw_service
from server.schemas import GenerateMediaRequest, GenerateMediaResponse
from utils.config_loader import get_config, get_video_frames_config
from utils.video_frames import (
    BackgroundRemovalOptions,
    build_spritesheet,
    export_processed_frames,
    extract_frames as extract_video_frames,
    video_extract_frames,
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
    cols: Optional[int] = None
    max_frames: Optional[int] = None


class VideoExtractFramesRequest(BackgroundOptionsRequest):
    """视频抽帧请求"""
    video_url: str
    transparent: bool = True   # True→rembg 抠图（透明）；False→原背景
    max_frames: Optional[int] = None
    fps: Optional[float] = None


class VideoFramePreviewRequest(BaseModel):
    """视频抽帧预览请求"""
    video_url: str
    max_frames: Optional[int] = 64
    fps: Optional[float] = None


class VideoFrameExportRequest(BackgroundOptionsRequest):
    """抽帧编辑器导出请求"""
    frame_urls: List[str]
    output: Literal['zip', 'spritesheet'] = 'zip'
    cols: Optional[int] = None


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


def _load_frame_urls(frame_urls: List[str]) -> List[Image.Image]:
    if not frame_urls:
        raise HTTPException(status_code=400, detail='请至少选择一帧')
    if len(frame_urls) > 600:
        raise HTTPException(status_code=400, detail='一次最多导出 600 帧')

    frames: List[Image.Image] = []
    for url in frame_urls:
        frame_path = _resolve_upload_path(url, label='帧文件')
        try:
            with Image.open(frame_path) as img:
                frames.append(img.convert('RGB'))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f'帧文件读取失败: {e}')
    return frames


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
        # 读取图片
        contents = await file.read()
        image = Image.open(BytesIO(contents))
        
        # 转换为 RGB
        if image.mode != 'RGB':
            image = image.convert('RGB')
        
        # 转换为 base64
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

    try:
        png_bytes, meta = await asyncio.to_thread(
            video_to_spritesheet,
            video_path,
            cols=request.cols,
            max_frames=request.max_frames if request.max_frames is not None else cfg.max_frames,
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


@router.post("/video-extract-frames")
async def extract_frames(request: VideoExtractFramesRequest) -> dict:
    """视频 → 逐帧 PNG ZIP。transparent 决定是否 rembg 抠图。"""
    video_path = _resolve_upload_path(request.video_url, label='视频')
    cfg = get_video_frames_config()
    bg_options = _background_options(request, fallback_mode=cfg.background_mode if request.transparent else 'none')
    transparent = bg_options.mode != 'none'

    try:
        zip_bytes, meta = await asyncio.to_thread(
            video_extract_frames,
            video_path,
            transparent=transparent,
            max_frames=request.max_frames,
            fps=request.fps,
            model=bg_options.rembg_model,
            background_options=bg_options,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'抽帧失败: {e}')

    save_dir = Path(get_config().paths.upload_dir) / 'frames'
    save_dir.mkdir(parents=True, exist_ok=True)
    filename = f'frames_{uuid.uuid4().hex}.zip'
    (save_dir / filename).write_bytes(zip_bytes)

    return {
        'success': True,
        'zip_url': f'/uploads/frames/{filename}',
        'frames': meta['frames'],
        'transparent': meta['transparent'],
        'background_mode': bg_options.mode,
    }


@router.post("/video-frame-preview")
async def preview_video_frames(request: VideoFramePreviewRequest) -> dict:
    """视频 → 预览帧。供前端编辑器选择帧后再导出。"""
    video_path = _resolve_upload_path(request.video_url, label='视频')
    max_frames = request.max_frames or get_video_frames_config().max_frames
    max_frames = max(1, min(max_frames, 600))

    try:
        frames = await asyncio.to_thread(
            extract_video_frames,
            video_path,
            max_frames=max_frames,
            fps=request.fps,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'预览帧抽取失败: {e}')

    if not frames:
        raise HTTPException(status_code=500, detail='未抽取到任何预览帧')

    preview_id = f'preview_{uuid.uuid4().hex}'
    save_dir = Path(get_config().paths.upload_dir) / 'frames' / 'previews' / preview_id
    save_dir.mkdir(parents=True, exist_ok=True)

    frame_items = []
    for i, frame in enumerate(frames):
        filename = f'frame_{i + 1:04d}.png'
        frame.save(save_dir / filename, format='PNG')
        frame_items.append({
            'index': i,
            'url': f'/uploads/frames/previews/{preview_id}/{filename}',
            'width': frame.width,
            'height': frame.height,
        })

    return {
        'success': True,
        'preview_id': preview_id,
        'frames': frame_items,
        'width': frames[0].width,
        'height': frames[0].height,
    }


@router.post("/export-video-frames")
async def export_video_frames(request: VideoFrameExportRequest) -> dict:
    """按编辑器选择的帧导出 ZIP 或精灵图。"""
    frames = _load_frame_urls(request.frame_urls)
    bg_options = _background_options(request, fallback_mode='none')
    transparent = bg_options.mode != 'none'

    try:
        processed = await asyncio.to_thread(
            export_processed_frames,
            frames,
            background_options=bg_options,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'背景处理失败: {e}')

    if request.output == 'spritesheet':
        try:
            png_bytes, cols, rows = await asyncio.to_thread(build_spritesheet, processed, request.cols)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f'精灵图生成失败: {e}')

        save_dir = Path(get_config().paths.upload_dir) / 'spritesheet'
        save_dir.mkdir(parents=True, exist_ok=True)
        filename = f'sheet_{uuid.uuid4().hex}.png'
        (save_dir / filename).write_bytes(png_bytes)
        return {
            'success': True,
            'spritesheet_url': f'/uploads/spritesheet/{filename}',
            'frames': len(processed),
            'cols': cols,
            'rows': rows,
            'background_mode': bg_options.mode,
        }

    try:
        zip_bytes = await asyncio.to_thread(zip_frames, processed, transparent)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'ZIP 打包失败: {e}')

    save_dir = Path(get_config().paths.upload_dir) / 'frames'
    save_dir.mkdir(parents=True, exist_ok=True)
    filename = f'frames_{uuid.uuid4().hex}.zip'
    (save_dir / filename).write_bytes(zip_bytes)
    return {
        'success': True,
        'zip_url': f'/uploads/frames/{filename}',
        'frames': len(processed),
        'transparent': transparent,
        'background_mode': bg_options.mode,
    }
