"""Local media helpers: facts about files, alpha flattening, data URLs and result names."""
import base64
import io
import mimetypes
import re
from pathlib import Path
from typing import Optional

from PIL import Image, ImageColor, UnidentifiedImageError

from .errors import CliError

RESULT_EXTENSION = re.compile(r"\.(png|jpe?g|webp|gif|mp4|webm)$", re.IGNORECASE)


def has_alpha(image: Image.Image) -> bool:
    return image.mode in ("RGBA", "RGBa", "LA", "La", "PA") or "transparency" in image.info


def describe(path: Path) -> Optional[dict]:
    """Size, format and alpha of an image file, or None when it is not an image."""
    try:
        with Image.open(path) as image:
            return {
                "width": image.width,
                "height": image.height,
                "format": (image.format or "").lower(),
                "has_alpha": has_alpha(image),
                "frames": int(getattr(image, "n_frames", 1) or 1),
            }
    except (UnidentifiedImageError, OSError):
        return None


def flatten(path: Path, color: str, workdir: Path) -> Path:
    """Composite a transparent image onto a solid colour; ComfyUI drops alpha from its inputs anyway."""
    try:
        with Image.open(path) as image:
            if not has_alpha(image):
                return path
            rgba = image.convert("RGBA")
    except (UnidentifiedImageError, OSError):
        return path
    try:
        rgb = ImageColor.getrgb(color)[:3]
    except ValueError as error:
        raise CliError(f"无法识别的颜色：{color}") from error
    background = Image.new("RGBA", rgba.size, (*rgb, 255))
    background.alpha_composite(rgba)
    workdir.mkdir(parents=True, exist_ok=True)
    target = workdir / f"{path.stem}.flat.png"
    background.convert("RGB").save(target, "PNG")
    return target


def png_data_url(path: Path) -> str:
    with Image.open(path) as image:
        buffer = io.BytesIO()
        image.convert("RGBA").save(buffer, "PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def url_extension(url: str, default: str = "png") -> str:
    match = RESULT_EXTENSION.search(url.split("?", 1)[0].split("#", 1)[0])
    if not match:
        return default
    extension = match.group(1).lower()
    return "jpg" if extension == "jpeg" else extension


def guess_mime(path: Path) -> str:
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"
