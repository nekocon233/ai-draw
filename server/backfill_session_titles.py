"""Backfill blank, default, and legacy timestamp chat-session titles."""
import re

from server.database import SessionLocal
from server.models import ChatMessage, ChatSession
from utils.session_title import get_session_title_generator


LEGACY_TITLE_PATTERN = re.compile(r"^对话\s+\d{4}/\d{1,2}/\d{1,2}\s+\d{1,2}:\d{2}:\d{2}$")


def needs_title(title: str | None) -> bool:
    value = (title or "").strip()
    return not value or value == "新对话" or len(value) > 10 or bool(LEGACY_TITLE_PATTERN.fullmatch(value))


def main() -> None:
    db = SessionLocal()
    updated = 0
    skipped_without_text = 0
    try:
        sessions = db.query(ChatSession).order_by(ChatSession.created_at.asc()).all()
        candidates = [session for session in sessions if needs_title(session.title)]
        generator = get_session_title_generator()

        for index, session in enumerate(candidates, start=1):
            messages = (
                db.query(ChatMessage)
                .filter(
                    ChatMessage.session_id == session.session_id,
                    ChatMessage.content.isnot(None),
                )
                .order_by(ChatMessage.created_at.asc())
                .all()
            )
            content = "\n".join(
                f"{'用户' if message.type == 'user' else '助手'}：{message.content.strip()}"
                for message in messages
                if message.content and message.content.strip()
            )
            if not content:
                skipped_without_text += 1
                print(f"[SessionTitleBackfill] {index}/{len(candidates)} skipped: no text")
                continue

            session.title = generator.generate(content)
            db.commit()
            updated += 1
            print(f"[SessionTitleBackfill] {index}/{len(candidates)} updated")

        print(
            f"[SessionTitleBackfill] complete: candidates={len(candidates)}, "
            f"updated={updated}, skipped_without_text={skipped_without_text}"
        )
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
