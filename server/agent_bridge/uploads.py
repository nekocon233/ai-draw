"""Agent uploads: stored byte-for-byte (alpha and animation intact) under /uploads/agent/{uid}/{YYYYMM}/.

The format is judged from the content, never from the client's filename. Files that nothing references
are swept after a week, because an agent may upload references it never ends up using.
"""
import os
import time
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional

from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from utils.file_storage import get_file_storage
from utils.media_file_references import delete_unreferenced_media
from utils.reference_video import ReferenceVideoError, probe_reference_video, sniff_container

AGENT_ROOT = "agent"
MAX_UPLOAD_BYTES = 100 * 1024 * 1024
MAX_IMAGE_EDGE = 8192
MAX_IMAGE_PIXELS = 40_000_000
MAX_IMAGE_FRAMES = 600
MAX_VIDEO_SECONDS = 120.0
ORPHAN_MAX_AGE_SECONDS = 7 * 24 * 3600
ORPHAN_SWEEP_LIMIT = 100
PARTIAL_MAX_AGE_SECONDS = 24 * 3600
IMAGE_EXTENSIONS = {"PNG": "png", "JPEG": "jpg", "WEBP": "webp", "GIF": "gif"}
VIDEO_EXTENSIONS = {"mov": "mp4", "matroska": "webm"}


class AgentUploadError(ValueError):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class StoredUpload:
    url: str
    kind: str  # image / video
    format: str
    width: int
    height: int
    frames: int
    has_alpha: bool
    bytes: int
    duration: Optional[float] = None

    def to_dict(self) -> dict:
        return asdict(self)


def user_upload_dir(user_id: int) -> Path:
    return get_file_storage().upload_dir / AGENT_ROOT / str(user_id)


def _has_alpha(image: Image.Image) -> bool:
    return image.mode in ("RGBA", "RGBa", "LA", "La", "PA") or "transparency" in image.info


def _inspect_image(path: Path) -> Optional[dict]:
    """Image facts from the header, or None when the bytes are not an image Pillow can read."""
    try:
        with Image.open(path) as image:
            image_format = image.format
            width, height = image.size
            if image_format not in IMAGE_EXTENSIONS:
                raise AgentUploadError("图片只支持 PNG、JPEG、WebP 或 GIF", 415)
            if width <= 0 or height <= 0 or max(width, height) > MAX_IMAGE_EDGE or width * height > MAX_IMAGE_PIXELS:
                raise AgentUploadError(f"图片尺寸超出限制（单边不超过 {MAX_IMAGE_EDGE}，总像素不超过 {MAX_IMAGE_PIXELS}）", 413)
            has_alpha = _has_alpha(image)
            frames = int(getattr(image, "n_frames", 1) or 1)
        if frames > MAX_IMAGE_FRAMES:
            raise AgentUploadError(f"动图不能超过 {MAX_IMAGE_FRAMES} 帧", 413)
        with Image.open(path) as image:
            image.verify()
    except UnidentifiedImageError:
        return None
    except Image.DecompressionBombError as error:
        raise AgentUploadError("图片尺寸超出限制", 413) from error
    except AgentUploadError:
        raise
    except Exception as error:
        raise AgentUploadError(f"图片文件已损坏：{error}") from error
    return {
        "kind": "image",
        "format": image_format.lower(),
        "extension": IMAGE_EXTENSIONS[image_format],
        "width": width,
        "height": height,
        "frames": frames,
        "has_alpha": has_alpha,
        "duration": None,
    }


def _inspect_video(path: Path) -> dict:
    try:
        demuxer = sniff_container(path)
        info = probe_reference_video(path, demuxer)
    except ReferenceVideoError as error:
        raise AgentUploadError(f"无法识别的文件：只支持 PNG、JPEG、WebP、GIF 图片或 MP4、WebM 视频（{error}）", 415) from error
    if info.duration > MAX_VIDEO_SECONDS:
        raise AgentUploadError(f"视频不能超过 {MAX_VIDEO_SECONDS:g} 秒", 413)
    return {
        "kind": "video",
        "format": VIDEO_EXTENSIONS[demuxer],
        "extension": VIDEO_EXTENSIONS[demuxer],
        "width": info.width,
        "height": info.height,
        "frames": info.frames,
        "has_alpha": False,
        "duration": round(info.duration, 3),
    }


def store_upload(source: Path, user_id: int, now: Optional[datetime] = None) -> StoredUpload:
    """Validate a fully received upload and move it into place; the source is consumed on success."""
    size = source.stat().st_size
    if size <= 0:
        raise AgentUploadError("文件为空", 400)
    if size > MAX_UPLOAD_BYTES:
        raise AgentUploadError("文件不能超过 100MB", 413)
    facts = _inspect_image(source) or _inspect_video(source)
    month = (now or datetime.now()).strftime("%Y%m")
    directory = user_upload_dir(user_id) / month
    directory.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}.{facts['extension']}"
    os.replace(source, directory / name)
    return StoredUpload(
        url=f"/uploads/{AGENT_ROOT}/{user_id}/{month}/{name}",
        kind=facts["kind"],
        format=facts["format"],
        width=facts["width"],
        height=facts["height"],
        frames=facts["frames"],
        has_alpha=facts["has_alpha"],
        bytes=size,
        duration=facts["duration"],
    )


def sweep_orphans(db: Session, user_id: int, keep: Iterable[str] = (), now: Optional[float] = None,
                  max_age_seconds: int = ORPHAN_MAX_AGE_SECONDS, limit: int = ORPHAN_SWEEP_LIMIT) -> None:
    """Delete this user's old agent files that nothing references, and abandoned partial uploads."""
    root = user_upload_dir(user_id)
    if not root.is_dir():
        return
    now = time.time() if now is None else now
    keep = set(keep)
    for partial in root.glob(".*.part"):
        try:
            if now - partial.stat().st_mtime > PARTIAL_MAX_AGE_SECONDS:
                partial.unlink(missing_ok=True)
        except OSError:
            pass
    stale = []
    for path in sorted(root.glob("*/*")):
        if len(stale) >= limit:
            break
        if not path.is_file() or path.name.startswith(".") or path.name in keep:
            continue
        try:
            if now - path.stat().st_mtime < max_age_seconds:
                continue
        except OSError:
            continue
        stale.append(f"{AGENT_ROOT}/{user_id}/{path.parent.name}/{path.name}")
    if stale:
        delete_unreferenced_media(db, stale)
