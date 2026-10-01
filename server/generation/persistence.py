"""Database result replacement and cleanup live outside the HTTP router."""
from typing import List, Literal, Optional
from .contracts import TaskContext

def _persist_assistant_message(
    user_id: int,
    session_id: str,
    message_id: str,
    images: List[str],
    *,
    replace_existing: bool = True,
    source_updates: Optional[dict] = None,
    seeds: Optional[List[Optional[int]]] = None,
) -> Literal['persisted', 'target_missing', 'failed']:
    """把生成结果（助手消息 + GeneratedImage 行）落库。

    仅在 BackgroundTask 内调用，使用独立 DB session 避免与请求作用域冲突。
    占位写入不会清除旧结果；新结果提交成功后才删除旧文件。
    """
    from server.database import SessionLocal
    from server.models import ChatMessage, ChatSession, GeneratedImage
    from utils.file_storage import get_file_storage
    from utils.media_file_references import delete_unreferenced_media

    db = SessionLocal()
    file_storage = get_file_storage()
    old_paths: list[str] = []
    new_paths: list[str] = []
    created_paths: list[str] = []
    stale_reference_paths: list[str] = []
    try:
        session = db.query(ChatSession).filter(
            ChatSession.session_id == session_id,
            ChatSession.user_id == user_id,
        ).first()
        if not session:
            return 'target_missing'

        source_message_id = message_id.removesuffix('-reply')
        source_message = db.query(ChatMessage).filter(
            ChatMessage.user_id == user_id,
            ChatMessage.session_id == session_id,
            ChatMessage.message_id == source_message_id,
            ChatMessage.type == 'user',
        ).first()
        if not source_message:
            return 'target_missing'

        if replace_existing and source_updates:
            reference_fields = {
                'reference_image',
                'reference_image_2',
                'reference_image_3',
                'reference_image_end',
            }
            for field in (
                'content',
                'workflow',
                'strength',
                'count',
                'lora_prompt',
                'reference_image',
                'reference_image_2',
                'reference_image_3',
                'reference_image_end',
                'workflow_options',
                'width',
                'height',
                'use_original_size',
                'prompt_preset',
                'motion_reference_images',
                'motion_prompt',
            ):
                if field in source_updates:
                    old_value = getattr(source_message, field)
                    if field == 'motion_reference_images':
                        stale_reference_paths.extend(set(old_value or []) - set(source_updates[field] or []))
                    if field in reference_fields and old_value and old_value != source_updates[field]:
                        stale_reference_paths.append(old_value)
                    setattr(source_message, field, source_updates[field])

        existing = db.query(ChatMessage).filter(
            ChatMessage.user_id == user_id,
            ChatMessage.session_id == session_id,
            ChatMessage.message_id == message_id,
            ChatMessage.type == 'assistant',
        ).first()

        def _resolve_path(idx: int, img_data: str) -> str:
            # 以 / 开头的是已落盘的视频/图片 URL（如 /uploads/video/xxx.mp4），直接存路径
            if img_data.startswith('/'):
                return img_data
            # base64 数据走 file_storage 标准保存路径
            file_path = file_storage.save_generated_image(
                base64_data=img_data,
                user_id=user_id,
                message_id=message_id,
                index=idx,
            )
            created_paths.append(file_path)
            return file_path

        if existing:
            if not replace_existing:
                return 'persisted'
            old_paths = [image.file_path for image in existing.images]
            for img in list(existing.images):
                db.delete(img)
            db.flush()
        else:
            chat_msg = ChatMessage(
                session_id=session_id,
                user_id=user_id,
                message_id=message_id,
                type='assistant',
                content='',
            )
            db.add(chat_msg)
            db.flush()

        for idx, img_data in enumerate(images):
            if not isinstance(img_data, str) or not img_data:
                continue
            try:
                file_path = _resolve_path(idx, img_data)
            except Exception as exc:
                print(f"[media] 持久化生成图失败 idx={idx}: {exc}")
                file_path = img_data
            new_paths.append(file_path)
            db.add(GeneratedImage(
                message_id=message_id,
                image_index=idx,
                file_path=file_path,
                seed=seeds[idx] if seeds and idx < len(seeds) else None,
            ))
        db.commit()
        try:
            delete_unreferenced_media(
                db,
                (set(old_paths) - set(new_paths)) | set(stale_reference_paths),
            )
        except Exception as cleanup_error:
            print(f"[media] 清理旧媒体失败: {cleanup_error}")
        return 'persisted'
    except Exception as exc:
        db.rollback()
        for created_path in created_paths:
            file_storage.delete_file(created_path)
        print(f"[media] 持久化 assistant 消息失败: {exc}")
        return 'failed'
    finally:
        db.close()


def _delete_generated_files(images: List[str]) -> None:
    from server.database import SessionLocal
    from utils.media_file_references import delete_unreferenced_media

    # An in-progress preview may already have been saved as a reference elsewhere.
    with SessionLocal() as db:
        delete_unreferenced_media(db, [image for image in images if isinstance(image, str)])



class SQLAlchemyGenerationRepository:
    def persist(self, context: TaskContext, images: list[str], *, replace_existing=True, source_updates=None, seeds=None):
        if not context.session_id or not context.message_id:
            return "persisted"
        return _persist_assistant_message(
            context.user_id, context.session_id, context.message_id, images,
            replace_existing=replace_existing, source_updates=source_updates, seeds=seeds,
        )

    def discard(self, images: list[str]) -> None:
        _delete_generated_files(images)
