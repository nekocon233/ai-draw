"""
视频抽帧 / 透明精灵图 共享核心

对外编排函数：
- video_to_spritesheet: 视频 → ffmpeg 抽帧 → rembg 逐帧抠图 → 网格 PNG（透明 spritesheet）

复用既有实现：
- ffmpeg subprocess + tempfile 模式：utils/media_processor.py
- 网格拼图逻辑：utils/pixel_lab.py:200-230

注意：rembg / transparent-background 均为惰性导入，本模块其余部分不依赖这些 AI 抠图库，
因此 extract_frames / build_spritesheet 可在未安装对应依赖时独立使用。
"""
import io
import math
import os
import glob
import shutil
import subprocess
import tempfile
import zipfile
from collections import deque
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import Callable, List, Literal, Optional, Tuple

from PIL import Image, ImageChops, ImageFilter


# 抽帧上限默认值
DEFAULT_MAX_FRAMES = 64          # 透明（需 rembg，较慢）

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


@dataclass(frozen=True)
class ExtractedVideoFrame:
    """带时间戳的视频抽帧结果。"""
    image: Image.Image
    time: Optional[float]
    source_index: int


def _evenly_sample(n: int, k: int) -> List[int]:
    """从 n 个帧中等间距抽取 k 个的索引（含首尾）。"""
    if k >= n:
        return list(range(n))
    if k <= 1:
        return [0]
    return [round(i * (n - 1) / (k - 1)) for i in range(k)]


def _safe_fps_value(fps: Optional[float]) -> Optional[float]:
    if fps is None:
        return None
    try:
        value = float(fps)
    except (TypeError, ValueError):
        return None
    if value <= 0:
        return None
    return min(value, 120.0)


def extract_frame_items(
    video_path: Path,
    max_frames: Optional[int] = None,
    fps: Optional[float] = None,
    start_time: Optional[float] = None,
    end_time: Optional[float] = None,
) -> List[ExtractedVideoFrame]:
    """用 ffmpeg 从视频抽帧，返回带近似时间戳的 RGB 帧。"""
    video_path = Path(video_path)
    if not video_path.exists():
        raise FileNotFoundError(f'视频不存在: {video_path}')

    start = max(0, float(start_time)) if start_time is not None else 0.0
    end = max(0, float(end_time)) if end_time is not None else None
    duration = end - start if end is not None else None
    if duration is not None and duration <= 0:
        raise ValueError('结束时间必须大于开始时间')

    requested_fps = _safe_fps_value(fps)
    source_fps = probe_video_fps(video_path)
    effective_fps = requested_fps or source_fps

    tmpdir = tempfile.mkdtemp(prefix='vframe_')
    try:
        pattern = os.path.join(tmpdir, 'frame_%05d.png')
        cmd = ['ffmpeg', '-y']
        if start > 0:
            cmd += ['-ss', f'{start:.3f}']
        cmd += ['-i', str(video_path)]
        if duration is not None:
            cmd += ['-t', f'{duration:.3f}']
        if requested_fps is not None:
            cmd += ['-vf', f'fps={requested_fps}']
        cmd.append(pattern)

        result = subprocess.run(cmd, capture_output=True, timeout=600)
        if result.returncode != 0:
            err = result.stderr.decode('utf-8', errors='ignore')[-800:]
            raise RuntimeError(f'ffmpeg 抽帧失败: {err}')

        files = sorted(glob.glob(os.path.join(tmpdir, 'frame_*.png')))
        if not files:
            raise RuntimeError('ffmpeg 未抽到任何帧（可能视频损坏）')

        raw_items: List[ExtractedVideoFrame] = []
        denominator = effective_fps if effective_fps and effective_fps > 0 else None
        for i, file_path in enumerate(files):
            image = Image.open(file_path).convert('RGB')
            timestamp = start + (i / denominator) if denominator else None
            if end is not None and timestamp is not None:
                timestamp = min(timestamp, end)
            raw_items.append(ExtractedVideoFrame(image=image, time=timestamp, source_index=i))

        if max_frames and len(raw_items) > max_frames:
            idxs = _evenly_sample(len(raw_items), max_frames)
            raw_items = [raw_items[i] for i in idxs]

        return raw_items
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def extract_frames(
    video_path: Path,
    max_frames: Optional[int] = None,
    fps: Optional[float] = None,
    start_time: Optional[float] = None,
    end_time: Optional[float] = None,
) -> List[Image.Image]:
    """
    用 ffmpeg 从视频抽帧，返回 RGB PIL Image 列表。

    Args:
        video_path: 视频文件路径
        max_frames: 帧数上限；超过则等间距抽样到此数量
        fps: 抽帧率；None 表示按原视频帧率全抽
        start_time: 开始时间（秒）
        end_time: 结束时间（秒）
    """
    return [item.image for item in extract_frame_items(
        video_path,
        max_frames=max_frames,
        fps=fps,
        start_time=start_time,
        end_time=end_time,
    )]


def probe_video_fps(video_path: Path) -> Optional[float]:
    """读取视频第一路视频流的平均帧率；失败时返回 None，不阻断抽帧。"""
    try:
        result = subprocess.run(
            [
                'ffprobe',
                '-v', 'error',
                '-select_streams', 'v:0',
                '-show_entries', 'stream=avg_frame_rate,r_frame_rate',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                str(video_path),
            ],
            capture_output=True,
            timeout=30,
        )
    except Exception:
        return None

    if result.returncode != 0:
        return None

    for line in result.stdout.decode('utf-8', errors='ignore').splitlines():
        value = line.strip()
        if not value or value == '0/0':
            continue
        try:
            fps = float(Fraction(value)) if '/' in value else float(value)
        except (ValueError, ZeroDivisionError):
            continue
        if fps > 0:
            return fps
    return None


def probe_video_duration(video_path: Path) -> Optional[float]:
    """读取视频总时长（秒）；失败时返回 None，不阻断抽帧。"""
    try:
        result = subprocess.run(
            [
                'ffprobe',
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                str(video_path),
            ],
            capture_output=True,
            timeout=30,
        )
    except Exception:
        return None

    if result.returncode != 0:
        return None
    try:
        duration = float(result.stdout.decode('utf-8', errors='ignore').strip())
    except ValueError:
        return None
    return duration if duration > 0 else None


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


def _edge_connected_background_mask(diff: Image.Image, threshold: int, soften: int) -> Image.Image:
    """只保留与画面边缘连通的近背景色区域，避免误删主体内部同色区域。"""
    w, h = diff.size
    background = diff.point(lambda value: 255 if value <= threshold else 0).convert('L')
    data = background.load()
    visited = bytearray(w * h)
    q: deque[tuple[int, int]] = deque()

    def push(x: int, y: int) -> None:
        idx = y * w + x
        if visited[idx] or data[x, y] == 0:
            return
        visited[idx] = 1
        q.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)

    while q:
        x, y = q.popleft()
        if x > 0:
            push(x - 1, y)
        if x + 1 < w:
            push(x + 1, y)
        if y > 0:
            push(x, y - 1)
        if y + 1 < h:
            push(x, y + 1)

    connected = Image.new('L', (w, h), 0)
    out = connected.load()
    for y in range(h):
        offset = y * w
        for x in range(w):
            if visited[offset + x]:
                out[x, y] = 255

    if soften > 1:
        # 小残留填补 + 主体边缘轻微内缩/去污。
        grow = min(4, max(1, soften // 10))
        for _ in range(grow):
            connected = connected.filter(ImageFilter.MaxFilter(3))
        connected = connected.filter(ImageFilter.MedianFilter(3))
    return connected


def remove_backgrounds_by_edge_color(
    frames: List[Image.Image],
    threshold: int = 32,
    feather: int = 10,
    on_progress: ProgressFn = None,
) -> List[Image.Image]:
    """
    根据画面边缘采样背景色做透明化，适合纯色、干净背景的视频。

    与旧版全图阈值不同，这里只清除与画面边缘连通的近背景色区域，并做少量
    边缘去污/平滑，减少白边、黑边和误删主体内部同色区域。
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
        background_mask = _edge_connected_background_mask(diff, threshold, feather)

        # 背景 mask 255 表示透明背景；转为 alpha：背景 0，主体 255。
        alpha = ImageChops.invert(background_mask)
        if feather > 1:
            radius = min(3.0, feather / 12)
            alpha = alpha.filter(ImageFilter.GaussianBlur(radius=radius))
            # 把明确背景压回透明，减少半透明脏边。
            alpha = ImageChops.multiply(alpha, ImageChops.invert(background_mask.filter(ImageFilter.MinFilter(3))))

        rgba.putalpha(alpha)
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
        return [frame.convert('RGBA') for frame in frames]
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


# ── 打包：网格 PNG / APNG / GIF / ZIP ─────────────────────────────────────
def build_spritesheet(
    frames_rgba: List[Image.Image],
    cols: Optional[int] = None,
    rows: Optional[int] = None,
) -> Tuple[bytes, int, int]:
    """
    把透明帧拼成一张网格 PNG（透明底）。

    Args:
        frames_rgba: 透明帧列表（RGBA）
        cols: 列数；None 时按 ceil(sqrt(n)) 自动计算
        rows: 行数；提供时优先按行数反推列数

    Returns:
        (png_bytes, cols, rows)
    """
    if not frames_rgba:
        raise ValueError('无可用帧，无法生成精灵图')

    n = len(frames_rgba)
    # 统一为 RGBA 并以首帧尺寸为单元格尺寸
    frames_rgba = [f.convert('RGBA') for f in frames_rgba]
    frame_w, frame_h = frames_rgba[0].size

    if rows and rows > 0:
        rows = min(max(1, int(rows)), n)
        cols = math.ceil(n / rows)
    else:
        if not cols or cols < 1:
            cols = max(1, math.ceil(math.sqrt(n)))
        cols = min(max(1, int(cols)), n)
        rows = math.ceil(n / cols)

    sheet = Image.new('RGBA', (cols * frame_w, rows * frame_h), (0, 0, 0, 0))
    for i, frame in enumerate(frames_rgba):
        # 尺寸不一致时按首帧尺寸缩放（保险）
        if frame.size != (frame_w, frame_h):
            frame = frame.resize((frame_w, frame_h), Image.LANCZOS)
        sheet.paste(frame, ((i % cols) * frame_w, (i // cols) * frame_h), frame)

    buf = io.BytesIO()
    sheet.save(buf, format='PNG')
    return buf.getvalue(), cols, rows


def build_apng(frames_rgba: List[Image.Image], fps: Optional[float] = None) -> Tuple[bytes, int]:
    """把帧保存为 APNG，返回 PNG 字节和单帧时长毫秒。"""
    if not frames_rgba:
        raise ValueError('无可用帧，无法生成 APNG')

    fps = min(max(fps or 12, 0.1), 60)
    duration_ms = max(1, round(1000 / fps))

    frames_rgba = [frame.convert('RGBA') for frame in frames_rgba]
    frame_w, frame_h = frames_rgba[0].size
    normalized = [
        frame if frame.size == (frame_w, frame_h) else frame.resize((frame_w, frame_h), Image.LANCZOS)
        for frame in frames_rgba
    ]

    buf = io.BytesIO()
    first, rest = normalized[0], normalized[1:]
    first.save(
        buf,
        format='PNG',
        save_all=True,
        append_images=rest,
        duration=duration_ms,
        loop=0,
        disposal=2,
    )
    return buf.getvalue(), duration_ms


def build_gif(frames_rgba: List[Image.Image], fps: Optional[float] = None) -> Tuple[bytes, int]:
    """把帧保存为 GIF，返回 GIF 字节和单帧时长毫秒。GIF 透明度支持有限。"""
    if not frames_rgba:
        raise ValueError('无可用帧，无法生成 GIF')

    fps = min(max(fps or 12, 0.1), 60)
    duration_ms = max(1, round(1000 / fps))
    rgba_frames = [frame.convert('RGBA') for frame in frames_rgba]
    frame_w, frame_h = rgba_frames[0].size
    normalized = [
        frame if frame.size == (frame_w, frame_h) else frame.resize((frame_w, frame_h), Image.LANCZOS)
        for frame in rgba_frames
    ]

    paletted = []
    for frame in normalized:
        # Pillow 的 GIF 透明支持为单色索引；保留 alpha 大致轮廓，同时避免脏色背景。
        alpha = frame.getchannel('A')
        rgb = Image.new('RGBA', frame.size, (255, 255, 255, 0))
        rgb.alpha_composite(frame)
        converted = rgb.convert('P', palette=Image.Palette.ADAPTIVE, colors=255)
        mask = alpha.point(lambda value: 255 if value <= 12 else 0)
        converted.paste(255, mask)
        converted.info['transparency'] = 255
        paletted.append(converted)

    buf = io.BytesIO()
    first, rest = paletted[0], paletted[1:]
    first.save(
        buf,
        format='GIF',
        save_all=True,
        append_images=rest,
        duration=duration_ms,
        loop=0,
        disposal=2,
        transparency=255,
    )
    return buf.getvalue(), duration_ms


def zip_frames(frames_rgba: List[Image.Image], name_template: str = '{n:03}') -> bytes:
    """把帧按 PNG 序列打包为 ZIP。"""
    if not frames_rgba:
        raise ValueError('无可用帧，无法生成 ZIP')

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode='w', compression=zipfile.ZIP_DEFLATED) as zf:
        for i, frame in enumerate(frames_rgba, start=1):
            png_buf = io.BytesIO()
            frame.convert('RGBA').save(png_buf, format='PNG')
            try:
                stem = name_template.format(n=i, index=i - 1)
            except Exception:
                stem = f'{i:03}'
            stem = stem.strip().replace('\\', '_').replace('/', '_') or f'{i:03}'
            if not stem.lower().endswith('.png'):
                stem = f'{stem}.png'
            zf.writestr(stem, png_buf.getvalue())
    return buf.getvalue()


def resize_frames(
    frames: List[Image.Image],
    width: Optional[int] = None,
    height: Optional[int] = None,
) -> List[Image.Image]:
    """统一调整帧尺寸；只给宽或高时按首帧比例补齐另一边。"""
    if not frames or (not width and not height):
        return frames

    base_w, base_h = frames[0].size
    target_w = int(width) if width and width > 0 else None
    target_h = int(height) if height and height > 0 else None

    if target_w is None and target_h is not None:
        target_w = max(1, round(target_h * base_w / base_h))
    if target_h is None and target_w is not None:
        target_h = max(1, round(target_w * base_h / base_w))
    if target_w is None or target_h is None:
        return frames

    target_size = (target_w, target_h)
    return [
        frame if frame.size == target_size else frame.resize(target_size, Image.LANCZOS)
        for frame in frames
    ]


# ── 对外编排 ────────────────────────────────────────────────────────────
def video_to_spritesheet(
    video_path: Path,
    rows: Optional[int] = None,
    max_frames: Optional[int] = None,
    start_time: Optional[float] = None,
    end_time: Optional[float] = None,
    model: str = 'isnet-anime',
    on_progress: ProgressFn = None,
    background_options: Optional[BackgroundRemovalOptions] = None,
) -> Tuple[bytes, dict]:
    """
    视频 → 透明精灵图（单张网格 PNG）。

    Returns:
        (png_bytes, meta)  meta = {frames, cols, rows}
    """
    frames = extract_frames(
        video_path,
        max_frames=max_frames or DEFAULT_MAX_FRAMES,
        start_time=start_time,
        end_time=end_time,
    )
    rgba = apply_background_removal(
        frames,
        options=background_options or BackgroundRemovalOptions(mode='ai', rembg_model=model),
        on_progress=on_progress,
    )
    png, c, r = build_spritesheet(rgba, rows=rows)
    return png, {'frames': len(rgba), 'cols': c, 'rows': r}


def export_processed_frames(
    frames: List[Image.Image],
    background_options: Optional[BackgroundRemovalOptions] = None,
    on_progress: ProgressFn = None,
) -> List[Image.Image]:
    """对已抽出的帧应用背景处理，供编辑器导出复用。"""
    return apply_background_removal(frames, options=background_options, on_progress=on_progress)
