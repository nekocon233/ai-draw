"""Exercise HTTP ownership and SQL result replacement without a live database/API."""
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from server.api.generation import get_generation_coordinator, router
from server.auth import get_current_user
from server.database import Base, get_db
from server.generation.contracts import GenerationParameters, TaskContext
from server.generation.coordinator import GenerationCoordinator
from server.generation.events import EventPublisher
from server.generation.persistence import SQLAlchemyGenerationRepository
from server.models import ChatMessage, ChatSession, GeneratedImage, User


class ImmediateEngine:
    def validate(self, parameters):
        if parameters.workflow != "test":
            raise ValueError("Unknown workflow")

    async def generate(self, parameters, context, on_artifact, check_cancelled):
        on_artifact("/uploads/generated/1/new.png", 0, 1)
        return ["/uploads/generated/1/new.png"]

    async def interrupt(self, workflow, runner):
        pass


class GenerationIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.sessions() as db:
            db.add_all([User(id=1, username="owner", password_hash="test"), User(id=2, username="other", password_hash="test")])
            db.add(ChatSession(user_id=1, session_id="session-a", title="Existing session"))
            db.flush()
            db.add(ChatMessage(user_id=1, session_id="session-a", message_id="message-a", type="user", content="original prompt"))
            db.add(ChatMessage(user_id=1, session_id="session-a", message_id="message-a-reply", type="assistant", content=""))
            db.flush()
            db.add(GeneratedImage(message_id="message-a-reply", image_index=0, file_path="/uploads/generated/1/old.png"))
            db.commit()
        self.storage = SimpleNamespace(delete_file=Mock(), save_generated_image=Mock())
        self.addCleanup(self.engine.dispose)
        self.patch_session = patch("server.database.SessionLocal", self.sessions)
        self.patch_session.start()
        self.addCleanup(self.patch_session.stop)
        for target in ("utils.file_storage.get_file_storage", "utils.media_file_references.get_file_storage"):
            mock = patch(target, return_value=self.storage)
            mock.start()
            self.addCleanup(mock.stop)
        self.repository = SQLAlchemyGenerationRepository()
        self.context = TaskContext(1, "task-a", "test", "session-a", "message-a-reply")
        self.coordinator = GenerationCoordinator(ImmediateEngine(), self.repository, EventPublisher())
        self.user_id = 1
        self.app = FastAPI()
        self.app.include_router(router, prefix="/api/media")

        def database():
            with self.sessions() as db:
                yield db

        self.app.dependency_overrides[get_db] = database
        self.app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=self.user_id)
        self.app.dependency_overrides[get_generation_coordinator] = lambda: self.coordinator
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)

    def persisted_images(self):
        with self.sessions() as db:
            return [image.file_path for image in db.query(GeneratedImage).all()]

    def test_motion_references_are_owned_ordered_and_persisted(self):
        response = self.client.post('/api/media/generate', json={
            'prompt': 'move', 'workflow': 'test', 'motion_reference_images': ['/uploads/reference/2/pose.png'],
        })
        self.assertEqual(response.status_code, 403)
        self.assertIsNone(self.coordinator.tasks.active)
        images = ['/uploads/reference/1/pose-b.png', '/uploads/reference/1/pose-a.png']
        self.assertEqual(self.repository.persist(self.context, ['/uploads/generated/1/new.png'],
                         source_updates={'workflow': 'test', 'motion_reference_images': images}), 'persisted')
        from server.api.session import _serialize_message
        with self.sessions() as db:
            source = db.query(ChatMessage).filter_by(message_id='message-a').one()
            self.assertEqual(_serialize_message(source)['params']['motionReferenceImages'], images)
        self.storage.delete_file.reset_mock()
        self.repository.discard(images)
        self.storage.delete_file.assert_not_called()

    def test_motion_session_config_survives_clear_and_protects_shared_media(self):
        from server.api.session import SessionConfigRequest, get_session_config, update_session_config
        user = SimpleNamespace(id=1, username='owner')
        images = ['/uploads/reference/1/pose.png']
        with self.sessions() as db:
            update_session_config('session-a', SessionConfigRequest(motion_reference_images=images), user, db)
            self.assertEqual(get_session_config('session-a', user, db)['motion_reference_images'], images)
            self.repository.discard(images)
            self.storage.delete_file.assert_not_called()
            update_session_config('session-a', SessionConfigRequest(motion_reference_images=[]), user, db)
            self.assertEqual(get_session_config('session-a', user, db)['motion_reference_images'], [])
        self.storage.delete_file.assert_called_once_with(images[0])

    def test_motion_prompt_snapshot_persists_and_input_changes_invalidate_it(self):
        from server.api.session import SessionConfigRequest, get_session_config, update_session_config, _serialize_message
        from utils.motion_prompt import motion_prompt_input_hash
        character = '/uploads/reference/1/character.png'
        poses = ['/uploads/reference/1/a.png', '/uploads/reference/1/b.png']
        snapshot = {'version':1,'input_hash':motion_prompt_input_hash(character,poses,''),'prompt':'从原姿势缓慢抬手。'}
        user = SimpleNamespace(id=1,username='owner')
        with self.sessions() as db:
            update_session_config('session-a',SessionConfigRequest(reference_image=character,motion_reference_images=poses,prompt='',motion_prompt=snapshot),user,db)
            self.assertEqual(get_session_config('session-a',user,db)['motion_prompt'],snapshot)
            update_session_config('session-a',SessionConfigRequest(count=1),user,db)
            self.assertEqual(get_session_config('session-a',user,db)['motion_prompt'],snapshot)
            update_session_config('session-a',SessionConfigRequest(motion_reference_images=list(reversed(poses))),user,db)
            self.assertIsNone(get_session_config('session-a',user,db)['motion_prompt'])
        self.assertEqual(self.repository.persist(self.context,['/uploads/generated/1/new.png'],source_updates={
            'workflow':'minimax_h3_ref','content':'','reference_image':character,'motion_reference_images':poses,'motion_prompt':snapshot,
        }), 'persisted')
        with self.sessions() as db:
            source=db.query(ChatMessage).filter_by(message_id='message-a').one()
            self.assertEqual(source.content,'')
            self.assertEqual(_serialize_message(source)['params']['motionPrompt'],snapshot)

    def test_placeholder_preserves_existing_result(self):
        self.assertEqual(self.repository.persist(self.context, [], replace_existing=False), "persisted")
        self.assertEqual(self.persisted_images(), ["/uploads/generated/1/old.png"])
        self.storage.delete_file.assert_not_called()

    def test_success_replaces_results_and_source_in_one_transaction(self):
        preset = {"id": "pose", "title": "参考姿势", "prompt": "参照第二张图。"}
        status = self.repository.persist(
            self.context, ["/uploads/generated/1/new.png"],
            source_updates={"content": "new prompt", "workflow": "test", "width": 768, "height": 1024,
                            "use_original_size": False, "prompt_preset": preset},
        )
        self.assertEqual(status, "persisted")
        self.assertEqual(self.persisted_images(), ["/uploads/generated/1/new.png"])
        with self.sessions() as db:
            message = db.query(ChatMessage).filter_by(message_id="message-a").one()
            self.assertEqual(message.content, "new prompt")
            from server.api.session import _serialize_message, _summary_text
            params = _serialize_message(message)["params"]
            self.assertEqual((params["width"], params["height"], params["useOriginalSize"]), (768, 1024, False))
            self.assertEqual(params["promptPreset"], preset)
            self.assertEqual(_summary_text(message), "预设「参考姿势」 new prompt")
        self.storage.delete_file.assert_called_once_with("/uploads/generated/1/old.png")

    def test_commit_failure_rolls_back_replacement_and_does_not_delete_old_files(self):
        class FailingCommit(Session):
            def commit(self):
                raise RuntimeError("simulated database failure")

        factory = sessionmaker(bind=self.engine, class_=FailingCommit)
        with patch("server.database.SessionLocal", factory):
            status = self.repository.persist(
                self.context, ["/uploads/generated/1/new.png"], source_updates={"content": "bad replacement"},
            )
        self.assertEqual(status, "failed")
        self.assertEqual(self.persisted_images(), ["/uploads/generated/1/old.png"])
        with self.sessions() as db:
            self.assertEqual(db.query(ChatMessage).filter_by(message_id="message-a").one().content, "original prompt")
        self.storage.delete_file.assert_not_called()

    def test_repository_rejects_other_users_target(self):
        context = TaskContext(2, "wrong-owner", "test", "session-a", "message-a-reply")
        self.assertEqual(self.repository.persist(context, ["new"]), "target_missing")
        self.assertEqual(self.persisted_images(), ["/uploads/generated/1/old.png"])

    def test_cleanup_keeps_files_already_referenced_by_another_persisted_record(self):
        self.repository.discard(["/uploads/generated/1/old.png", "/uploads/generated/1/unreferenced.png"])
        self.storage.delete_file.assert_called_once_with("/uploads/generated/1/unreferenced.png")

    def test_submit_returns_task_id_and_persists_without_websocket(self):
        preset = {"id": "pose", "title": "参考姿势", "description": "跟随动作", "prompt": "参照第二张图。"}
        response = self.client.post("/api/media/generate", json={
            "prompt": "new prompt", "workflow": "test", "count": 1, "prompt_preset": preset,
            "message_id": "message-a-reply", "session_id": "session-a",
        })
        self.assertEqual(response.status_code, 200, response.text)
        task_id = response.json()["task_id"]
        self.assertTrue(task_id)
        snapshot = self.client.get("/api/media/last-task").json()["last_task"]
        self.assertEqual(snapshot["task_id"], task_id)
        self.assertEqual(snapshot["status"], "completed")
        self.assertEqual(self.persisted_images(), ["/uploads/generated/1/new.png"])
        with self.sessions() as db:
            source = db.query(ChatMessage).filter_by(message_id="message-a").one()
            self.assertEqual(source.content, "new prompt")
            self.assertEqual(source.prompt_preset, {**preset, "output_type": "image", "requires_motion_reference": False,
                                                    "motion_reference_mode": "pose", "workflow_ids": None, "hint": "", "images": []})
        self.user_id = 2
        self.assertIsNone(self.client.get("/api/media/last-task").json()["last_task"])

    def test_missing_authentication_is_rejected(self):
        del self.app.dependency_overrides[get_current_user]
        response = self.client.post("/api/media/generate", json={"prompt": "x", "workflow": "test"})
        self.assertEqual(response.status_code, 401)
        self.assertIsNone(self.coordinator.tasks.active)

    def test_preset_choices_roundtrip_opt_out_and_session_ownership(self):
        from server.api.session import router as session_router
        from server.api.prompt import PROMPT_PRESETS
        self.app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=self.user_id, username='test-owner')
        self.app.include_router(session_router, prefix='/api')
        preset = next(p.model_dump() for p in PROMPT_PRESETS if p.id == 'video_transition')
        path = '/api/chat/sessions/session-a/config'
        choices = {'minimax_h3': preset, 'minimax_h3_ref': None}
        response = self.client.put(path, json={'workflow': 'minimax_h3', 'prompt': '',
                                  'prompt_preset': preset, 'prompt_preset_choices': choices})
        self.assertEqual(response.status_code, 200)
        restored = self.client.get(path).json()
        self.assertEqual(restored['prompt_preset_choices'], choices)
        self.assertEqual(restored['prompt'], '')
        self.client.put(path, json={'prompt_preset': None})
        self.assertEqual(self.client.get(path).json()['prompt_preset_choices'],
                         {'minimax_h3': None, 'minimax_h3_ref': None})
        # A late catalog must still be allowed to initialize an explicitly uninitialized mode.
        self.client.put(path, json={'prompt_preset': None, 'prompt_preset_choices': {}})
        self.assertEqual(self.client.get(path).json()['prompt_preset_choices'], {})
        self.user_id = 2
        self.assertEqual(self.client.get(path).status_code, 404)
        self.assertEqual(self.client.put(path, json={'prompt_preset_choices': choices}).status_code, 404)

    def test_submit_cannot_use_another_users_session(self):
        self.user_id = 2
        response = self.client.post("/api/media/generate", json={
            "prompt": "x", "workflow": "test", "session_id": "session-a", "message_id": "message-a-reply",
        })
        self.assertEqual(response.status_code, 404)
        self.assertIsNone(self.coordinator.tasks.active)

    def test_busy_and_stale_stop_do_not_replace_task(self):
        original = self.coordinator.reserve(self.context, GenerationParameters("x", workflow="test"))
        response = self.client.post("/api/media/generate", json={"prompt": "x", "workflow": "test"})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.client.post("/api/media/stop?task_id=old-task").status_code, 409)
        self.user_id = 2
        self.assertEqual(self.client.post("/api/media/stop?task_id=task-a").status_code, 403)
        self.assertIs(self.coordinator.tasks.active, original)
        self.assertFalse(original.cancel_requested)


if __name__ == "__main__":
    unittest.main()
