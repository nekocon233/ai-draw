import unittest
from datetime import datetime
from unittest.mock import patch

from sqlalchemy import Column, DateTime, Integer, MetaData, String, Table, Text, create_engine, inspect, select
from sqlalchemy.orm import Session

from server.database import Base
from server.legacy_media import migrate_retired_style_references
from server.models import ChatMessage, ChatSession, GeneratedImage, User
from utils.media_file_references import user_owns_media_path


class LegacyMediaMigrationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        self.legacy = Table(
            "generation_style_references", MetaData(),
            Column("id", String(32), primary_key=True), Column("user_id", Integer),
            Column("message_id", String(50)), Column("file_path", Text), Column("created_at", DateTime),
        )
        self.legacy.create(self.engine)
        with Session(self.engine) as db:
            db.add_all([User(id=1, username="owner", password_hash="test"), User(id=2, username="other", password_hash="test")])
            db.add(ChatSession(user_id=1, session_id="session", title="History"))
            db.add(ChatMessage(user_id=1, session_id="session", message_id="round", type="user", content="Original", workflow="ideogram_style"))
            db.add(ChatMessage(user_id=1, session_id="session", message_id="round-reply", type="assistant", content=""))
            db.add(GeneratedImage(message_id="round-reply", image_index=0, file_path="/uploads/generated/1/final.png"))
            db.commit()
        self.reference = dict(id="a" * 32, user_id=1, message_id="round", file_path="/uploads/generated/1/reference.png", created_at=datetime(2026, 9, 19))

    def migrate(self):
        with self.engine.begin() as connection:
            return migrate_retired_style_references(connection)

    def test_preserves_results_ownership_and_history_then_retires_the_table(self):
        with self.engine.begin() as connection:
            connection.execute(self.legacy.insert().values(**self.reference))
        self.assertEqual(self.migrate(), 1)
        self.assertFalse(inspect(self.engine).has_table(self.legacy.name))
        self.assertEqual(self.migrate(), 0)
        with Session(self.engine) as db:
            from server.api.session import _serialize_message
            reply = db.query(ChatMessage).filter_by(message_id="round-reply").one()
            with patch("server.api.session.get_file_storage"):
                self.assertEqual(_serialize_message(reply)["images"], ["/uploads/generated/1/final.png", self.reference["file_path"]])
            self.assertTrue(user_owns_media_path(db, 1, self.reference["file_path"]))
            self.assertFalse(user_owns_media_path(db, 2, self.reference["file_path"]))
            self.assertEqual(db.query(ChatMessage).filter_by(message_id="round").one().workflow, "ideogram_style")

    def test_failed_final_generation_still_keeps_its_intermediate_image(self):
        with self.engine.begin() as connection:
            connection.execute(GeneratedImage.__table__.delete())
            connection.execute(ChatMessage.__table__.delete().where(ChatMessage.message_id == "round-reply"))
            connection.execute(self.legacy.insert().values(**self.reference))
        self.assertEqual(self.migrate(), 1)
        with Session(self.engine) as db:
            reply = db.query(ChatMessage).filter_by(message_id="round-reply").one()
            self.assertEqual((reply.user_id, reply.session_id, reply.type), (1, "session", "assistant"))
            self.assertEqual([image.file_path for image in reply.images], [self.reference["file_path"]])

    def test_already_preserved_image_is_not_duplicated(self):
        with self.engine.begin() as connection:
            connection.execute(self.legacy.insert().values(**{**self.reference, "file_path": "/uploads/generated/1/final.png"}))
        self.assertEqual(self.migrate(), 0)
        with Session(self.engine) as db:
            self.assertEqual(db.query(GeneratedImage).count(), 1)

    def test_inconsistent_ownership_rolls_back_and_keeps_legacy_records(self):
        with self.engine.begin() as connection:
            connection.execute(self.legacy.insert(), [self.reference, {**self.reference, "id": "b" * 32, "user_id": 2}])
        with self.assertRaisesRegex(ValueError, "owned source"):
            self.migrate()
        self.assertTrue(inspect(self.engine).has_table(self.legacy.name))
        with self.engine.connect() as connection:
            self.assertEqual(len(connection.execute(select(self.legacy)).all()), 2)
            self.assertEqual(len(connection.execute(select(GeneratedImage)).all()), 1)


if __name__ == "__main__":
    unittest.main()
