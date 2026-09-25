"""Persist usable defaults and keep retired history intact through the HTTP APIs."""
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from server.api.session import router as session_router
from server.api.service import router as service_router
from server.api.user import router as user_router
from server.ai_draw_service import get_ai_draw_service
from server.auth import get_current_user
from server.database import Base, get_db
from server.generation.contracts import GenerationParameters
from server.models import ChatMessage, ChatSession, GeneratedImage, User, UserConfig
from server.schemas import GenerateMediaRequest
from utils.config_loader import WorkflowDefaultsConfig


class WorkflowDefaultsTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[1]
        self.defaults = WorkflowDefaultsConfig(**yaml.safe_load(
            (root / "configs/app_config.yaml").read_text(encoding="utf-8")
        )["workflow_defaults"])
        config = SimpleNamespace(workflow_defaults=self.defaults, auth=SimpleNamespace(invite_code="test-invite"))
        patcher = patch("utils.config_loader.get_config", return_value=config)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        with self.sessions() as db:
            db.add(User(id=1, username="owner", password_hash="unused"))
            db.commit()

        def database():
            with self.sessions() as db:
                yield db

        app = FastAPI()
        app.include_router(user_router, prefix="/api")
        app.include_router(session_router, prefix="/api")
        app.include_router(service_router, prefix="/api")
        app.dependency_overrides[get_ai_draw_service] = lambda: SimpleNamespace(
            catalog=SimpleNamespace(list=lambda: list(self.defaults.workflow_metadata)),
            get_current_workflow=lambda: "minimax_h3",
        )
        app.dependency_overrides[get_db] = database
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1, username="owner")
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_request_defaults_resolve_to_a_selectable_workflow(self):
        workflow = self.defaults.current_workflow_type
        self.assertEqual(workflow, "qwen_image_21_t2i")
        self.assertIn(workflow, self.defaults.workflow_metadata)
        self.assertEqual(GenerateMediaRequest(prompt="x").workflow, workflow)
        self.assertEqual(GenerationParameters("x").workflow, workflow)

    def test_prompt_templates_keep_the_user_description(self):
        for workflow in self.defaults.workflow_metadata:
            template = self.defaults.get_workflow_prompt_template(workflow)
            if template:
                with self.subTest(workflow=workflow):
                    self.assertIn("{desc}", template)
                    self.assertIn("用户原文", template.format(desc="用户原文"))

    def test_discovery_uses_the_configured_default_after_switching_workflows(self):
        response = self.client.get("/api/service/workflows")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["default_workflow"], "qwen_image_21_t2i")

    def test_missing_user_config_is_usable_with_an_empty_prompt(self):
        response = self.client.get("/api/config/user")
        self.assertEqual(response.status_code, 200, response.text)
        config = response.json()
        self.assertEqual((config["current_workflow"], config["lora_prompt"], config["count"]),
                         ("qwen_image_21_t2i", "", 1))
        self.assertIsNone(config["prompt"])

    def test_registration_and_new_sessions_use_the_configured_default(self):
        with patch("server.api.user.hash_password", return_value="unused"), \
                patch("server.api.user.create_access_token", return_value="test-token"):
            response = self.client.post("/api/auth/register", json={
                "username": "new-owner", "password": "unused", "invite_code": "test-invite",
            })
        self.assertEqual(response.status_code, 200, response.text)
        response = self.client.post("/api/chat/sessions", json={"session_id": "new-session"})
        self.assertEqual(response.status_code, 200, response.text)
        with self.sessions() as db:
            user_config = db.query(UserConfig).one()
            session = db.query(ChatSession).one()
            self.assertEqual((user_config.current_workflow, user_config.lora_prompt, user_config.count),
                             ("qwen_image_21_t2i", "", 1))
            self.assertEqual((session.config_workflow, session.config_lora_prompt, session.config_count),
                             ("qwen_image_21_t2i", "", 1))

    def test_reset_changes_defaults_without_rewriting_retired_history(self):
        with self.sessions() as db:
            db.add(UserConfig(user_id=1, current_workflow="t2i", lora_prompt="<lora:AmeniwaZ:0.8>", count=8))
            db.add(ChatSession(user_id=1, session_id="old-session", config_workflow="t2i"))
            db.flush()
            db.add_all([
                ChatMessage(user_id=1, session_id="old-session", message_id="old", type="user",
                            content="1girl", workflow="t2i", lora_prompt="<lora:AmeniwaZ:0.8>"),
                ChatMessage(user_id=1, session_id="old-session", message_id="old-reply", type="assistant"),
            ])
            db.flush()
            db.add(GeneratedImage(message_id="old-reply", image_index=0, file_path="/uploads/generated/1/old.png"))
            db.commit()
        response = self.client.delete("/api/config/user")
        self.assertEqual(response.status_code, 200, response.text)
        config = self.client.get("/api/config/user").json()
        self.assertIsNone(config["strength"])
        self.assertEqual((config["current_workflow"], config["lora_prompt"], config["count"]),
                         ("qwen_image_21_t2i", "", 1))
        with self.sessions() as db:
            message = db.query(ChatMessage).filter_by(message_id="old").one()
            self.assertEqual((message.content, message.workflow, message.lora_prompt),
                             ("1girl", "t2i", "<lora:AmeniwaZ:0.8>"))
            self.assertEqual(db.query(ChatSession).one().config_workflow, "t2i")
            self.assertEqual(db.query(GeneratedImage).one().file_path, "/uploads/generated/1/old.png")

    def test_wan_history_and_legacy_parameters_survive_session_fallback(self):
        from server.api.session import _serialize_message
        storage = SimpleNamespace(get_file_url=lambda path: path)
        storage_patch = patch('utils.file_storage._file_storage', storage)
        storage_patch.start()
        self.addCleanup(storage_patch.stop)
        for workflow in ('flf2v', 'i2v'):
            sid = f'legacy-{workflow}'
            with self.sessions() as db:
                db.add(ChatSession(user_id=1, session_id=sid, config_workflow=workflow,
                                   config_prompt_end='返回起始姿势', config_frame_count=81))
                db.flush()
                db.add_all([
                    ChatMessage(user_id=1, session_id=sid, message_id=sid, type='user',
                                content='抬手', workflow=workflow, prompt_end='返回起始姿势', frame_count=81),
                    ChatMessage(user_id=1, session_id=sid, message_id=sid+'-reply', type='assistant'),
                ])
                db.flush()
                db.add(GeneratedImage(message_id=sid+'-reply', image_index=0,
                                      file_path=f'/uploads/video/1/{workflow}.mp4'))
                db.commit()
            response = self.client.put(f'/api/chat/sessions/{sid}/config', json={
                'workflow': 'qwen_image_21_t2i', 'prompt': '新描述', 'lora_prompt': '',
            })
            self.assertEqual(response.status_code, 200, response.text)
            with self.sessions() as db:
                source = db.query(ChatMessage).filter_by(message_id=sid).one()
                saved = _serialize_message(source)
                self.assertEqual((saved['content'], saved['params']['workflow'], saved['params']['promptEnd'],
                                  saved['params']['frameCount']), ('抬手', workflow, '返回起始姿势', 81))
                reply = db.query(ChatMessage).filter_by(message_id=sid+'-reply').one()
                self.assertEqual(_serialize_message(reply)['images'], [f'/uploads/video/1/{workflow}.mp4'])
                session = db.query(ChatSession).filter_by(session_id=sid).one()
                self.assertEqual((session.config_prompt_end, session.config_frame_count), ('返回起始姿势', 81))
