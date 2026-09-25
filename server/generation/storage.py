"""Save provider results outside the event loop, with cancellation-safe cleanup."""
import asyncio
import base64
import logging
import uuid
from pathlib import Path
from typing import Literal, Optional

from utils.media_processor import resize_image_base64, resize_video_bytes
from .contracts import MediaOutput

logger = logging.getLogger(__name__)


class ArtifactStorage:
    def __init__(self, upload_dir: str):
        self.upload_dir = Path(upload_dir)

    async def save(
        self, output: MediaOutput, user_id: int, target_size: Optional[tuple[int, int]],
        *, resize_mode: Literal["cover", "contain"] = "cover",
    ) -> str:
        root, suffix = ("video", ".mp4") if output.kind == "video" else ("generated", ".png")
        relative = Path(root) / str(user_id) / f"{uuid.uuid4().hex}{suffix}"
        path = self.upload_dir / relative

        def write():
            content = output.content
            if isinstance(content, str):
                raw = content.split(",", 1)[1] if content.startswith("data:") else content
                data = base64.b64decode(raw)
            else:
                data = content
            if target_size:
                try:
                    if output.kind == "video":
                        data = resize_video_bytes(data, *target_size)
                    else:
                        resized = resize_image_base64(base64.b64encode(data).decode("ascii"), *target_size, mode=resize_mode)
                        data = base64.b64decode(resized)
                except Exception:
                    logger.exception("Resize failed; preserving the original generated media")
            path.parent.mkdir(parents=True, exist_ok=True)
            try:
                path.write_bytes(data)
            except BaseException:
                path.unlink(missing_ok=True)
                raise

        writer = asyncio.create_task(asyncio.to_thread(write))
        try:
            await asyncio.shield(writer)
        except asyncio.CancelledError as cancellation:
            try:
                await writer
            except Exception:
                logger.debug("Cancelled artifact writer failed", exc_info=True)
            finally:
                path.unlink(missing_ok=True)
            raise cancellation
        return f"/uploads/{relative.as_posix()}"
