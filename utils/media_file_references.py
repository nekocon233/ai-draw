from typing import Iterable
from pathlib import PurePosixPath
from urllib.parse import unquote, urlparse

from sqlalchemy import or_
from sqlalchemy.orm import Session

from server.models import ChatMessage, ChatSession, GeneratedImage, ReferenceImage
from utils.file_storage import get_file_storage

USER_SCOPED_ROOTS = {
    'video',
    'generated',
    'reference',
    'spritesheet',
    'frames',
    'transparent',
    'gif',
    'apng',
    'upscaled',
}


def _relative_storage_path(file_path: str) -> str:
    parsed = urlparse(file_path)
    path = unquote(parsed.path) if parsed.scheme in ('http', 'https') else file_path
    return path.removeprefix('/uploads/').removeprefix('uploads/')


def canonical_upload_url(file_path: str) -> str | None:
    parsed = urlparse(file_path)
    path = unquote(parsed.path) if parsed.scheme in ('http', 'https') else file_path
    if not (path.startswith('/uploads/') or path.startswith('uploads/')):
        return None
    relative = path.removeprefix('/uploads/').removeprefix('uploads/')
    segments = relative.split('/')
    if not segments or any(segment in ('', '.', '..') or '\\' in segment for segment in segments):
        return None
    return f"/uploads/{'/'.join(segments)}"


def _storage_path_variants(file_path: str) -> tuple[str, ...]:
    relative = _relative_storage_path(file_path)
    return tuple({file_path, relative, f'uploads/{relative}', f'/uploads/{relative}'})


def user_owns_media_path(db: Session, user_id: int, file_path: str) -> bool:
    canonical_url = canonical_upload_url(file_path)
    if not canonical_url:
        return False
    variants = _storage_path_variants(canonical_url)
    relative = _relative_storage_path(canonical_url)
    parts = PurePosixPath(relative).parts
    if '..' in parts:
        return False
    if len(parts) >= 2 and parts[0] in USER_SCOPED_ROOTS and parts[1] == str(user_id):
        return True

    return bool(
        db.query(GeneratedImage.id).join(
            ChatMessage,
            ChatMessage.message_id == GeneratedImage.message_id,
        ).filter(
            ChatMessage.user_id == user_id,
            GeneratedImage.file_path.in_(variants),
        ).first()
        or db.query(ReferenceImage.id).filter(
            ReferenceImage.user_id == user_id,
            ReferenceImage.file_path.in_(variants),
        ).first()
    )


def delete_unreferenced_media(db: Session, file_paths: Iterable[str]) -> None:
    """Delete upload files only when no persisted message or session still refers to them."""
    file_storage = get_file_storage()
    for file_path in set(file_paths):
        if not file_path or file_path.startswith('data:'):
            continue
        relative_parts = PurePosixPath(_relative_storage_path(file_path)).parts
        if not relative_parts or relative_parts[0] not in USER_SCOPED_ROOTS or '..' in relative_parts:
            continue
        variants = _storage_path_variants(file_path)
        referenced = (
            db.query(GeneratedImage.id).filter(GeneratedImage.file_path.in_(variants)).first()
            or db.query(ReferenceImage.id).filter(ReferenceImage.file_path.in_(variants)).first()
            or db.query(ChatMessage.id).filter(or_(
                ChatMessage.reference_image.in_(variants),
                ChatMessage.reference_image_2.in_(variants),
                ChatMessage.reference_image_3.in_(variants),
                ChatMessage.reference_image_end.in_(variants),
            )).first()
            or db.query(ChatSession.id).filter(or_(
                ChatSession.config_reference_image.in_(variants),
                ChatSession.config_reference_image_2.in_(variants),
                ChatSession.config_reference_image_3.in_(variants),
                ChatSession.config_reference_image_end.in_(variants),
            )).first()
        )
        if not referenced:
            file_storage.delete_file(file_path)
