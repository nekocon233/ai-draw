import base64
import binascii
from io import BytesIO
from pathlib import Path
from urllib.parse import unquote, urlparse

from PIL import Image, UnidentifiedImageError


def normalize_image_reference(value: str, upload_dir: str, label: str = "参考图") -> str:
    """Resolve a supported image reference and return validated base64 without a prefix."""
    reference = value.strip()
    if not reference:
        raise ValueError(f"{label}为空")

    if reference.startswith("data:"):
        header, separator, encoded = reference.partition(",")
        if not separator or not header.startswith("data:image/") or ";base64" not in header:
            raise ValueError(f"{label}不是有效的图片 data URL")
        raw = _decode_base64(encoded, label)
    else:
        parsed = urlparse(reference)
        path = unquote(parsed.path) if parsed.scheme in ("http", "https") else reference
        if path.startswith("/uploads/") or path.startswith("uploads/"):
            relative_path = path.removeprefix("/uploads/").removeprefix("uploads/")
            upload_root = Path(upload_dir).resolve()
            image_path = (upload_root / relative_path).resolve()
            if image_path != upload_root and upload_root not in image_path.parents:
                raise ValueError(f"{label}路径无效")
            try:
                raw = image_path.read_bytes()
            except OSError as exc:
                raise ValueError(f"{label}文件不存在或无法读取") from exc
        elif parsed.scheme in ("http", "https"):
            raise ValueError(f"{label}不支持站外图片地址，请先上传图片")
        else:
            raw = _decode_base64(reference, label)

    try:
        with Image.open(BytesIO(raw)) as image:
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as exc:
        raise ValueError(f"{label}不是有效的图片文件") from exc

    return base64.b64encode(raw).decode("ascii")


def _decode_base64(value: str, label: str) -> bytes:
    try:
        return base64.b64decode("".join(value.split()), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"{label}的 Base64 数据无效") from exc
