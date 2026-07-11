import base64
import io
import os
import subprocess
import tempfile
from PIL import Image


class ImageUpscaleValidationError(ValueError):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def resize_video_bytes(video_bytes: bytes, width: int, height: int) -> bytes:
    """
    使用 ffmpeg 将视频缩放裁剪到指定尺寸（cover 模式，与 resize_image_base64 行为一致）：
    - 等比放大使短边贴合目标，然后居中裁剪超出部分
    - 输出为 mp4（h264）

    Args:
        video_bytes: 原始视频字节
        width:       目标宽度（像素，需为偶数）
        height:      目标高度（像素，需为偶数）

    Returns:
        resize 后的视频字节，失败时返回原始字节
    """
    # 确保尺寸为偶数（h264 要求）
    width = width if width % 2 == 0 else width + 1
    height = height if height % 2 == 0 else height + 1

    in_fd, in_path = tempfile.mkstemp(suffix='.mp4')
    out_fd, out_path = tempfile.mkstemp(suffix='.mp4')
    try:
        with os.fdopen(in_fd, 'wb') as f:
            f.write(video_bytes)
        os.close(out_fd)

        # cover 模式：先放大使图像覆盖目标尺寸，再居中裁剪
        vf = f'scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}'
        cmd = [
            'ffmpeg', '-y',
            '-i', in_path,
            '-vf', vf,
            '-c:v', 'libx264',
            '-c:a', 'copy',
            '-movflags', '+faststart',
            out_path,
        ]
        result = subprocess.run(cmd, capture_output=True, timeout=120)
        if result.returncode != 0:
            print(f'[media_processor] ffmpeg resize 失败: {result.stderr.decode("utf-8", errors="ignore")}')
            return video_bytes

        with open(out_path, 'rb') as f:
            return f.read()
    except Exception as e:
        print(f'[media_processor] 视频 resize 异常: {e}')
        return video_bytes
    finally:
        for p in (in_path, out_path):
            try:
                os.unlink(p)
            except Exception:
                pass


def resize_image_base64(image_b64: str, width: int, height: int) -> str:
    """
    将 base64 图像缩放裁剪到指定尺寸（cover 模式）：
    - 原图横向（宽 > 高）：缩放使高度 = target_height，居中裁剪宽度
    - 原图纵向（高 > 宽）：缩放使宽度 = target_width，居中裁剪高度
    - 不拉伸、不填充，输出恰好为 (width, height)

    Args:
        image_b64: 原始图像的 base64 字符串（无 data URL 前缀）
        width:     目标宽度（像素）
        height:    目标高度（像素）

    Returns:
        缩放后的 PNG base64 字符串
    """
    img = Image.open(io.BytesIO(base64.b64decode(image_b64))).convert('RGB')
    orig_w, orig_h = img.size

    # cover 缩放：
    # - 原图宽 > 高（横图）：缩放使高度 = target_height，然后居中裁剪宽度
    # - 原图宽 < 高（竖图）：缩放使宽度 = target_width，然后居中裁剪高度
    # 即 scale = max(target_w/orig_w, target_h/orig_h)，确保整个目标区域被填满
    scale = max(width / orig_w, height / orig_h)
    new_w = int(orig_w * scale)
    new_h = int(orig_h * scale)
    img = img.resize((new_w, new_h), Image.LANCZOS)

    # 居中裁剪到目标尺寸
    crop_x = (new_w - width) // 2
    crop_y = (new_h - height) // 2
    img = img.crop((crop_x, crop_y, crop_x + width, crop_y + height))

    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return base64.b64encode(buf.getvalue()).decode('utf-8')


def upscale_image_lanczos(image: Image.Image, scale: int) -> Image.Image:
    """使用 Lanczos 按整数倍率放大，保留原始颜色模式和透明通道。"""
    return image.resize((image.width * scale, image.height * scale), Image.Resampling.LANCZOS)


def merge_upscaled_alpha(source: Image.Image, upscaled_rgb: Image.Image, size: tuple[int, int]) -> Image.Image:
    """将 AI 放大的 RGB 与按相同尺寸插值的源 Alpha 合并。"""
    rgb = upscaled_rgb.convert('RGB')
    if rgb.size != size:
        rgb = rgb.resize(size, Image.Resampling.LANCZOS)
    if source.mode not in {'RGBA', 'LA'} and 'transparency' not in source.info:
        return rgb
    alpha = source.convert('RGBA').getchannel('A').resize(size, Image.Resampling.LANCZOS)
    result = rgb.convert('RGBA')
    result.putalpha(alpha)
    return result


def decode_upscale_png_data_url(
    data_url: str,
    scale: int,
    max_edge: int,
    max_pixels: int,
    max_input_bytes: int,
    processing_scale: int | None = None,
) -> tuple[Image.Image, int, int]:
    """在解压像素前限制请求体和目标尺寸，避免压缩炸弹占满内存。"""
    prefix = 'data:image/png;base64,'
    if not data_url.startswith(prefix):
        raise ImageUpscaleValidationError('仅支持 PNG data URL')
    encoded = data_url[len(prefix):]
    max_encoded_length = ((max_input_bytes + 2) // 3) * 4
    if len(encoded) > max_encoded_length:
        raise ImageUpscaleValidationError('图片数据过大', status_code=413)
    try:
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) > max_input_bytes:
            raise ImageUpscaleValidationError('图片数据过大', status_code=413)
        with Image.open(io.BytesIO(raw)) as source:
            width = source.width * scale
            height = source.height * scale
            if width > max_edge or height > max_edge:
                raise ImageUpscaleValidationError(f'输出最长边不能超过 {max_edge}px')
            if width * height > max_pixels:
                raise ImageUpscaleValidationError(f'输出总像素不能超过 {max_pixels} pixels')
            internal_scale = processing_scale or scale
            processing_width = source.width * internal_scale
            processing_height = source.height * internal_scale
            if processing_width > max_edge or processing_height > max_edge:
                raise ImageUpscaleValidationError(
                    f'算法中间图像 {processing_width}x{processing_height} 超过 {max_edge}px 限制'
                )
            if processing_width * processing_height > max_pixels:
                raise ImageUpscaleValidationError(f'算法中间图像超过 {max_pixels} pixels 限制')
            source.load()
            return source.convert('RGBA'), width, height
    except ImageUpscaleValidationError:
        raise
    except Exception as e:
        raise ImageUpscaleValidationError(f'PNG 解码失败: {e}') from e
