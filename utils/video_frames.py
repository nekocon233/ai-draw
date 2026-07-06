"""
视频抽帧 / 透明精灵图 共享核心

两个对外编排函数：
- video_to_spritesheet: 视频 → ffmpeg 抽帧 → rembg 逐帧抠图 → 网格 PNG（透明 spritesheet）
- video_extract_frames: 视频 → ffmpeg 抽帧 →（可选 rembg 抠图）→ 逐帧 PNG ZIP

复用既有实现：
- ffmpeg subprocess + tempfile 模式：utils/media_processor.py
- 网格拼图逻辑：utils/pixel_lab.py:200-230

注意：rembg / transparent-background 均为惰性导入，本模块其余部分不依赖这些 AI 抠图库，
因此 extract_frames / build_spritesheet / zip_frames 可在未安装对应依赖时独立使用。
"""
import io
import math
import os
import glob
import shutil
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, List, Literal, Optional, Tuple

from PIL import Image, ImageChops, ImageFilter


# 抽帧上限默认值
DEFAULT_MAX_FRAMES = 64          # 透明（需 rembg，较慢）
DEFAULT_MAX_FRAMES_RAW = 600     # 原背景（仅抽帧，可更多）

ProgressFn = Optional[Callable[[int, int], None]]
BackgroundMode = Literal['none', 'ai', 'inspyrenet', 'birefnet', 'edge']


@dataclass(frozen=True)
class BackgroundRemovalOptions:
    """背景处理参数。"""
    mode: BackgroundMode = 'ai'
    rembg_model: str = 'isnet-anime'
    alpha_matting: bool = True
    alpha_matting_foreground_threshold: int = 240
    alpha_matting_background_threshold: int = 10
    alpha_matting_erode_size: int = 10
    post_process_mask: bool = True
    inspyrenet_mode: str = 'base'
    inspyrenet_resize: str = 'static'
    birefnet_model: str = 'ZhengPeng7/BiRefNet'
    birefnet_image_size: int = 1024
    birefnet_device: str = 'auto'
    birefnet_precision: str = 'auto'
    edge_threshold: int = 32
    edge_feather: int = 10


def _evenly_sample(n: int, k: int) -> List[int]:
    """从 n 个帧中等间距抽取 k 个的索引（含首尾）。"""
    if k >= n:
        return list(range(n))
    if k <= 1:
        return [0]
    return [round(i * (n - 1) / (k - 1)) for i in range(k)]


def extract_frames(
    video_path: Path,
    max_frames: Optional[int] = None,
    fps: Optional[float] = None,
) -> List[Image.Image]:
    """
    用 ffmpeg 从视频抽帧，返回 RGB PIL Image 列表。

    Args:
        video_path: 视频文件路径
        max_frames: 帧数上限；超过则等间距抽样到此数量
        fps: 抽帧率；None 表示按原视频帧率全抽
    """
    video_path = Path(video_path)
    if not video_path.exists():
        raise FileNotFoundError(f'视频不存在: {video_path}')

    tmpdir = tempfile.mkdtemp(prefix='vframe_')
    try:
        pattern = os.path.join(tmpdir, 'frame_%05d.png')
        cmd = ['ffmpeg', '-y', '-i', str(video_path)]
        if fps is not None and fps > 0:
            cmd += ['-vf', f'fps={fps}']
        cmd.append(pattern)

        result = subprocess.run(cmd, capture_output=True, timeout=600)
        if result.returncode != 0:
            err = result.stderr.decode('utf-8', errors='ignore')[-800:]
            raise RuntimeError(f'ffmpeg 抽帧失败: {err}')

        files = sorted(glob.glob(os.path.join(tmpdir, 'frame_*.png')))
        if not files:
            raise RuntimeError('ffmpeg 未抽到任何帧（可能视频损坏）')

        frames = [Image.open(f).convert('RGB') for f in files]

        if max_frames and len(frames) > max_frames:
            idxs = _evenly_sample(len(frames), max_frames)
            frames = [frames[i] for i in idxs]

        return frames
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ── rembg 抠图（惰性导入 + 单例 session） ────────────────────────────────
_rembg_sessions: dict = {}  # model -> session


def _get_rembg_session(model: str):
    """获取（必要时创建）rembg session，按 model 缓存复用，避免每帧重载模型。"""
    if model not in _rembg_sessions:
        from rembg import new_session
        _rembg_sessions[model] = new_session(model)
    return _rembg_sessions[model]


def remove_backgrounds(
    frames: List[Image.Image],
    model: str = 'isnet-anime',
    on_progress: ProgressFn = None,
    options: Optional[BackgroundRemovalOptions] = None,
) -> List[Image.Image]:
    """
    用 rembg 逐帧去除背景，返回 RGBA PIL Image 列表。

    Args:
        frames: 输入帧（RGB 或 RGBA）
        model: rembg 模型名，如 isnet-anime / isnet-general-use / u2net
        on_progress: 进度回调 (done, total)
    """
    from rembg import remove

    options = options or BackgroundRemovalOptions(rembg_model=model)
    session = _get_rembg_session(options.rembg_model or model)
    out: List[Image.Image] = []
    total = len(frames)
    for i, frame in enumerate(frames):
        out.append(remove(
            frame,
            session=session,
            alpha_matting=options.alpha_matting,
            alpha_matting_foreground_threshold=options.alpha_matting_foreground_threshold,
            alpha_matting_background_threshold=options.alpha_matting_background_threshold,
            alpha_matting_erode_size=options.alpha_matting_erode_size,
            post_process_mask=options.post_process_mask,
        ).convert('RGBA'))
        if on_progress:
            try:
                on_progress(i + 1, total)
            except Exception:
                pass
    return out


_inspyrenet_removers: dict = {}  # (mode, resize) -> Remover


def _get_inspyrenet_remover(mode: str, resize: str):
    """获取（必要时创建）InSPyReNet remover。"""
    key = (mode, resize)
    if key not in _inspyrenet_removers:
        try:
            from transparent_background import Remover
        except ImportError as exc:
            raise RuntimeError(
                'InSPyReNet 依赖未安装，请先安装 transparent-background（见 requirements.txt）'
            ) from exc
        _inspyrenet_removers[key] = Remover(mode=mode, resize=resize)
    return _inspyrenet_removers[key]


def remove_backgrounds_by_inspyrenet(
    frames: List[Image.Image],
    mode: str = 'base',
    resize: str = 'static',
    on_progress: ProgressFn = None,
) -> List[Image.Image]:
    """
    用 transparent-background / InSPyReNet 逐帧去除背景，返回 RGBA PIL Image 列表。
    """
    mode = mode if mode in {'base', 'fast', 'base-nightly'} else 'base'
    resize = resize if resize in {'static', 'dynamic'} else 'static'
    remover = _get_inspyrenet_remover(mode=mode, resize=resize)

    out: List[Image.Image] = []
    total = len(frames)
    for i, frame in enumerate(frames):
        out.append(remover.process(frame.convert('RGB'), type='rgba').convert('RGBA'))
        if on_progress:
            try:
                on_progress(i + 1, total)
            except Exception:
                pass
    return out


_birefnet_models: dict = {}  # (model, size, device, precision) -> (model, torch, transforms, device, dtype)


def _get_birefnet_model(model_name: str, image_size: int, device_name: str, precision: str):
    """获取（必要时创建）BiRefNet 模型。"""
    try:
        import torch
        from torchvision import transforms
        from transformers import AutoModelForImageSegmentation
    except ImportError as exc:
        raise RuntimeError(
            'BiRefNet 依赖未安装，请先安装 transformers、torch、torchvision、timm（见 requirements.txt）'
        ) from exc

    if device_name == 'auto':
        device_name = 'cuda' if torch.cuda.is_available() else 'cpu'
    device = torch.device(device_name)
    image_size = max(256, int(image_size or 1024))
    precision = precision if precision in {'auto', 'fp32', 'fp16', 'bf16'} else 'auto'

    if device.type == 'cuda' and precision in {'auto', 'fp16'}:
        dtype = torch.float16
    elif device.type == 'cuda' and precision == 'bf16':
        dtype = torch.bfloat16
    else:
        dtype = torch.float32

    key = (model_name, image_size, str(device), str(dtype))
    if key not in _birefnet_models:
        model = AutoModelForImageSegmentation.from_pretrained(
            model_name,
            trust_remote_code=True,
        )
        model.to(device)
        # HF 权重可能以 fp16 存储；CPU/FP32 路径也要显式转 dtype，
        # 否则会出现 input=float32 但 bias=float16 的卷积错误。
        model.to(dtype=dtype)
        model.eval()

        transform_image = transforms.Compose([
            transforms.Resize((image_size, image_size)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])
        _birefnet_models[key] = (model, torch, transforms, transform_image, device, dtype)
    return _birefnet_models[key]


def remove_backgrounds_by_birefnet(
    frames: List[Image.Image],
    model_name: str = 'ZhengPeng7/BiRefNet',
    image_size: int = 1024,
    device_name: str = 'auto',
    precision: str = 'auto',
    on_progress: ProgressFn = None,
) -> List[Image.Image]:
    """
    用 BiRefNet 逐帧预测 alpha mask 并合成 RGBA。
    """
    model, torch, transforms, transform_image, device, dtype = _get_birefnet_model(
        model_name=model_name,
        image_size=image_size,
        device_name=device_name,
        precision=precision,
    )

    out: List[Image.Image] = []
    total = len(frames)
    for i, frame in enumerate(frames):
        rgb = frame.convert('RGB')
        input_image = transform_image(rgb).unsqueeze(0).to(device)
        if dtype != torch.float32:
            input_image = input_image.to(dtype=dtype)

        with torch.no_grad():
            pred = model(input_image)[-1].sigmoid().detach().cpu()[0].squeeze()

        mask = transforms.ToPILImage()(pred).resize(rgb.size, Image.LANCZOS)
        rgba = rgb.convert('RGBA')
        rgba.putalpha(mask)
        out.append(rgba)

        if on_progress:
            try:
                on_progress(i + 1, total)
            except Exception:
                pass

    return out


def remove_backgrounds_by_edge_color(
    frames: List[Image.Image],
    threshold: int = 32,
    feather: int = 10,
    on_progress: ProgressFn = None,
) -> List[Image.Image]:
    """
    根据画面边缘采样背景色做透明化，适合纯色、干净背景的视频。
    """
    out: List[Image.Image] = []
    total = len(frames)
    threshold = max(0, int(threshold))
    feather = max(1, int(feather))

    for i, frame in enumerate(frames):
        rgba = frame.convert('RGBA')
        rgb = rgba.convert('RGB')
        w, h = rgb.size
        band = max(1, min(w, h, 8))
        edge_pixels = []
        edge_pixels.extend(rgb.crop((0, 0, w, band)).getdata())
        edge_pixels.extend(rgb.crop((0, h - band, w, h)).getdata())
        edge_pixels.extend(rgb.crop((0, 0, band, h)).getdata())
        edge_pixels.extend(rgb.crop((w - band, 0, w, h)).getdata())

        mid = len(edge_pixels) // 2
        bg = tuple(sorted(pixel[channel] for pixel in edge_pixels)[mid] for channel in range(3))
        channels = rgb.split()
        diffs = [
            ImageChops.difference(channel, Image.new('L', rgb.size, bg_value))
            for channel, bg_value in zip(channels, bg)
        ]
        diff = ImageChops.lighter(ImageChops.lighter(diffs[0], diffs[1]), diffs[2])
        mask = diff.point(lambda value: int(max(0, min(255, (value - threshold) / feather * 255))))
        if feather > 1:
            mask = mask.filter(ImageFilter.GaussianBlur(radius=min(4, feather / 4)))
        rgba.putalpha(mask)
        out.append(rgba)

        if on_progress:
            try:
                on_progress(i + 1, total)
            except Exception:
                pass

    return out


def apply_background_removal(
    frames: List[Image.Image],
    options: Optional[BackgroundRemovalOptions] = None,
    on_progress: ProgressFn = None,
) -> List[Image.Image]:
    """按选项处理背景。none 保留原图，ai 使用 rembg，inspyrenet/BiRefNet 使用对应模型，edge 使用边缘色抠图。"""
    options = options or BackgroundRemovalOptions()
    if options.mode == 'none':
        return [frame.convert('RGB') for frame in frames]
    if options.mode == 'inspyrenet':
        return remove_backgrounds_by_inspyrenet(
            frames,
            mode=options.inspyrenet_mode,
            resize=options.inspyrenet_resize,
            on_progress=on_progress,
        )
    if options.mode == 'birefnet':
        return remove_backgrounds_by_birefnet(
            frames,
            model_name=options.birefnet_model,
            image_size=options.birefnet_image_size,
            device_name=options.birefnet_device,
            precision=options.birefnet_precision,
            on_progress=on_progress,
        )
    if options.mode == 'edge':
        return remove_backgrounds_by_edge_color(
            frames,
            threshold=options.edge_threshold,
            feather=options.edge_feather,
            on_progress=on_progress,
        )
    return remove_backgrounds(
        frames,
        model=options.rembg_model,
        on_progress=on_progress,
        options=options,
    )


# ── 打包：网格 PNG / ZIP ────────────────────────────────────────────────
def build_spritesheet(
    frames_rgba: List[Image.Image],
    cols: Optional[int] = None,
) -> Tuple[bytes, int, int]:
    """
    把透明帧拼成一张网格 PNG（透明底）。

    Args:
        frames_rgba: 透明帧列表（RGBA）
        cols: 列数；None 时按 ceil(sqrt(n)) 自动计算

    Returns:
        (png_bytes, cols, rows)
    """
    if not frames_rgba:
        raise ValueError('无可用帧，无法生成精灵图')

    n = len(frames_rgba)
    # 统一为 RGBA 并以首帧尺寸为单元格尺寸
    frames_rgba = [f.convert('RGBA') for f in frames_rgba]
    frame_w, frame_h = frames_rgba[0].size

    if not cols or cols < 1:
        cols = max(1, math.ceil(math.sqrt(n)))
    rows = math.ceil(n / cols)

    sheet = Image.new('RGBA', (cols * frame_w, rows * frame_h), (0, 0, 0, 0))
    for i, frame in enumerate(frames_rgba):
        # 尺寸不一致时按首帧尺寸缩放（保险）
        if frame.size != (frame_w, frame_h):
            frame = frame.resize((frame_w, frame_h), Image.LANCZOS)
        sheet.paste(frame, ((i % cols) * frame_w, (i // cols) * frame_h))

    buf = io.BytesIO()
    sheet.save(buf, format='PNG')
    return buf.getvalue(), cols, rows


def zip_frames(frames: List[Image.Image], transparent: bool) -> bytes:
    """
    把帧逐张打成 ZIP（PNG）。

    Args:
        frames: 帧列表
        transparent: True→每帧 RGBA（透明）；False→每帧 RGB（原背景）
    """
    target_mode = 'RGBA' if transparent else 'RGB'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for i, frame in enumerate(frames):
            fr = frame if frame.mode == target_mode else frame.convert(target_mode)
            entry = io.BytesIO()
            fr.save(entry, format='PNG')
            zf.writestr(f'frame_{i + 1:04d}.png', entry.getvalue())
    return buf.getvalue()


# ── 对外编排 ────────────────────────────────────────────────────────────
def video_to_spritesheet(
    video_path: Path,
    cols: Optional[int] = None,
    max_frames: Optional[int] = None,
    model: str = 'isnet-anime',
    on_progress: ProgressFn = None,
    background_options: Optional[BackgroundRemovalOptions] = None,
) -> Tuple[bytes, dict]:
    """
    视频 → 透明精灵图（单张网格 PNG）。

    Returns:
        (png_bytes, meta)  meta = {frames, cols, rows}
    """
    frames = extract_frames(video_path, max_frames=max_frames or DEFAULT_MAX_FRAMES)
    rgba = apply_background_removal(
        frames,
        options=background_options or BackgroundRemovalOptions(mode='ai', rembg_model=model),
        on_progress=on_progress,
    )
    png, c, r = build_spritesheet(rgba, cols=cols)
    return png, {'frames': len(rgba), 'cols': c, 'rows': r}


def video_extract_frames(
    video_path: Path,
    transparent: bool = True,
    max_frames: Optional[int] = None,
    fps: Optional[float] = None,
    model: str = 'isnet-anime',
    on_progress: ProgressFn = None,
    background_options: Optional[BackgroundRemovalOptions] = None,
) -> Tuple[bytes, dict]:
    """
    视频 → 逐帧 PNG ZIP。

    Args:
        transparent: True→rembg 抠图（透明）；False→保留原背景
        max_frames: 帧数上限；None 时按 transparent 取默认（64 / 600）

    Returns:
        (zip_bytes, meta)  meta = {frames, transparent}
    """
    if max_frames is None:
        max_frames = DEFAULT_MAX_FRAMES if transparent else DEFAULT_MAX_FRAMES_RAW

    frames = extract_frames(video_path, max_frames=max_frames, fps=fps)
    if transparent:
        frames = apply_background_removal(
            frames,
            options=background_options or BackgroundRemovalOptions(mode='ai', rembg_model=model),
            on_progress=on_progress,
        )
    zip_bytes = zip_frames(frames, transparent=transparent)
    return zip_bytes, {'frames': len(frames), 'transparent': transparent}


def export_processed_frames(
    frames: List[Image.Image],
    background_options: Optional[BackgroundRemovalOptions] = None,
    on_progress: ProgressFn = None,
) -> List[Image.Image]:
    """对已抽出的帧应用背景处理，供编辑器导出复用。"""
    return apply_background_removal(frames, options=background_options, on_progress=on_progress)
