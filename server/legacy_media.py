"""One-time preservation of media from retired generation workflows."""
from sqlalchemy import MetaData, Table, func, inspect, select


def migrate_retired_style_references(connection) -> int:
    """Append old intermediate images to their round before dropping the old table.

    The caller owns the transaction. Existing results retain their order and paths;
    ownership inconsistencies abort the migration instead of discarding records.
    """
    table_name = "generation_style_references"
    if not inspect(connection).has_table(table_name):
        return 0

    from server.models import ChatMessage, GeneratedImage

    legacy = Table(table_name, MetaData(), autoload_with=connection)
    messages, images = ChatMessage.__table__, GeneratedImage.__table__
    migrated = 0
    references = connection.execute(select(legacy).order_by(legacy.c.created_at, legacy.c.id)).mappings().all()
    for reference in references:
        source = connection.execute(select(messages).where(
            messages.c.message_id == reference["message_id"],
            messages.c.user_id == reference["user_id"],
            messages.c.type == "user",
        )).mappings().first()
        if source is None:
            raise ValueError("Retired reference has no matching owned source message")

        reply_id = source["message_id"] + "-reply"
        if len(reply_id) > 50:
            raise ValueError("Retired reference reply ID exceeds the persisted limit")
        reply = connection.execute(select(messages).where(messages.c.message_id == reply_id)).mappings().first()
        if reply is not None and (
            reply["user_id"] != source["user_id"]
            or reply["session_id"] != source["session_id"]
            or reply["type"] != "assistant"
        ):
            raise ValueError("Retired reference reply belongs to a different round")
        if reply is None:
            connection.execute(messages.insert().values(
                message_id=reply_id, user_id=source["user_id"], session_id=source["session_id"],
                type="assistant", content="历史参考图片", created_at=reference["created_at"],
            ))

        already_saved = connection.execute(select(images.c.id).where(
            images.c.message_id == reply_id, images.c.file_path == reference["file_path"],
        )).first()
        if already_saved:
            continue
        last_index = connection.execute(select(func.max(images.c.image_index)).where(
            images.c.message_id == reply_id,
        )).scalar_one()
        connection.execute(images.insert().values(
            message_id=reply_id, image_index=0 if last_index is None else last_index + 1,
            file_path=reference["file_path"], created_at=reference["created_at"],
        ))
        migrated += 1

    legacy.drop(connection)
    return migrated
