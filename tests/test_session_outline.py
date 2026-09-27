"""Session outline: one lightweight entry per round for the result-area navigator."""
import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from server.api.session import get_session_outline
from server.database import Base
from server.models import ChatMessage, ChatSession, GeneratedImage, User


def at(minutes: int) -> datetime:
    return datetime(2026, 9, 1, 12, 0) + timedelta(minutes=minutes)


class SessionOutlineTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.addCleanup(self.engine.dispose)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        storage = SimpleNamespace(get_file_url=lambda path: f"/uploads/{path}")
        patcher = patch("server.api.session.get_file_storage", return_value=storage)
        patcher.start()
        self.addCleanup(patcher.stop)
        with self.sessions() as db:
            db.add_all([User(id=1, username="owner", password_hash="test"), User(id=2, username="other", password_hash="test")])
            db.add_all([
                ChatSession(user_id=1, session_id="session-a", title="A"),
                ChatSession(user_id=2, session_id="session-b", title="B"),
            ])
            db.flush()
            # Inserted out of order: rounds follow created_at, not insertion order.
            db.add_all([
                ChatMessage(user_id=1, session_id="session-a", message_id="late", type="user",
                            content="最后一轮", workflow="minimax_h3", created_at=at(20)),
                ChatMessage(user_id=1, session_id="session-a", message_id="late-reply", type="assistant",
                            content="", created_at=at(21)),
                ChatMessage(user_id=1, session_id="session-a", message_id="first", type="user",
                            content="长" * 200, workflow="qwen_image_21_t2i",
                            prompt_preset={"id": "sketch_finish", "title": "参考图成品化"},
                            reference_image="data:image/png;base64,AAAA", created_at=at(0)),
                ChatMessage(user_id=1, session_id="session-a", message_id="first-reply", type="assistant",
                            content="", created_at=at(1)),
                ChatMessage(user_id=1, session_id="session-a", message_id="pending", type="user",
                            content="", workflow="gpt_image", created_at=at(10)),
                ChatMessage(user_id=2, session_id="session-b", message_id="foreign", type="user",
                            content="别人的", workflow="gpt_image", created_at=at(5)),
            ])
            db.flush()
            db.add_all([
                GeneratedImage(message_id="first-reply", image_index=5, file_path="generated/1/f.png"),
                GeneratedImage(message_id="first-reply", image_index=0, file_path="generated/1/a.png"),
                GeneratedImage(message_id="first-reply", image_index=1, file_path="data:image/png;base64,BBBB"),
                GeneratedImage(message_id="first-reply", image_index=2, file_path="/uploads/video/1/c.mp4"),
                GeneratedImage(message_id="first-reply", image_index=3, file_path="generated/1/d.png"),
                GeneratedImage(message_id="first-reply", image_index=4, file_path="data:video/mp4;base64,CCCC"),
                GeneratedImage(message_id="first-reply", image_index=6, file_path="generated/1/g.png"),
                GeneratedImage(message_id="late-reply", image_index=0, file_path="/uploads/video/1/late.mp4"),
            ])
            db.commit()

    def outline(self, session_id: str, user_id: int = 1) -> list[dict]:
        with self.sessions() as db:
            return get_session_outline(session_id, SimpleNamespace(id=user_id), db)["rounds"]

    def test_rounds_follow_creation_time_and_pair_exact_replies(self):
        rounds = self.outline("session-a")
        self.assertEqual([item["id"] for item in rounds], ["first", "pending", "late"])
        self.assertEqual([item["timestamp"] for item in rounds],
                         [int(at(minutes).timestamp() * 1000) for minutes in (0, 10, 20)])
        pending = rounds[1]
        self.assertEqual((pending["content"], pending["media"], pending["media_count"]), ("", [], 0))
        self.assertIsNone(pending["preset_title"])
        late = rounds[2]
        self.assertEqual((late["workflow"], late["media"], late["media_count"]),
                         ("minimax_h3", ["/uploads/video/1/late.mp4"], 1))

    def test_preview_skips_inline_media_caps_thumbnails_and_truncates_text(self):
        first = self.outline("session-a")[0]
        self.assertEqual(first["media"], [
            "/uploads/generated/1/a.png",
            "/uploads/video/1/c.mp4",
            "/uploads/generated/1/d.png",
            "/uploads/generated/1/f.png",
        ])
        self.assertEqual(first["media_count"], 5)
        self.assertEqual(first["content"], "长" * 160)
        self.assertEqual(first["preset_title"], "参考图成品化")
        self.assertNotIn("reference_image", first)

    def test_other_users_and_missing_sessions_are_not_found(self):
        for session_id, user_id in (("session-a", 2), ("missing", 1)):
            with self.subTest(session_id=session_id, user_id=user_id):
                with self.assertRaises(HTTPException) as caught:
                    self.outline(session_id, user_id)
                self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual([item["id"] for item in self.outline("session-b", 2)], ["foreign"])


if __name__ == "__main__":
    unittest.main()
