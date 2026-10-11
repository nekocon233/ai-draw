"""Selecting results must never delete a round, another user's media, or shared files."""
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from server.api.generation import get_generation_coordinator
from server.api.session import router
from server.auth import get_current_user
from server.database import Base, get_db
from server.generation.contracts import TaskContext
from server.generation.tasks import TaskManager
from server.models import User, ChatSession, ChatMessage, GeneratedImage


class SelectiveMediaTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        self.addCleanup(engine.dispose)
        Base.metadata.create_all(engine)
        self.sessions = sessionmaker(bind=engine, expire_on_commit=False)
        self.urls = [f'/uploads/generated/1/{name}.png' for name in ('a', 'b', 'c')]
        with self.sessions() as db:
            db.add_all([User(id=1, username='one', password_hash='x'), User(id=2, username='two', password_hash='x')])
            db.add_all([ChatSession(session_id='session', user_id=1), ChatSession(session_id='other', user_id=2)])
            db.flush()
            db.add_all([
                ChatMessage(session_id='session', user_id=1, message_id='round', type='user', content='keep this prompt'),
                ChatMessage(session_id='session', user_id=1, message_id='round-reply', type='assistant'),
                ChatMessage(session_id='other', user_id=2, message_id='other-reply', type='assistant'),
            ])
            db.flush()
            db.add_all([GeneratedImage(message_id='round-reply', image_index=i, file_path=url, seed=100+i) for i, url in enumerate(self.urls)])
            db.commit()
        self.tasks = TaskManager()
        self.storage = SimpleNamespace(delete_file=Mock(), get_file_url=lambda path: '/uploads/' + path)
        storage = patch('utils.media_file_references.get_file_storage', return_value=self.storage)
        storage.start()
        self.addCleanup(storage.stop)
        self.user_id = 1
        app = FastAPI()
        app.include_router(router, prefix='/api')

        def database():
            with self.sessions() as db:
                yield db

        app.dependency_overrides[get_db] = database
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=self.user_id)
        app.dependency_overrides[get_generation_coordinator] = lambda: SimpleNamespace(tasks=self.tasks)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def delete(self, images, session='session', message='round-reply'):
        return self.client.request('DELETE', f'/api/chat/sessions/{session}/messages/{message}/media', json={'images': images})

    def test_deletes_only_selected_results_and_preserves_order_seeds_and_prompt(self):
        response = self.delete([self.urls[1]])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'images': [self.urls[0], self.urls[2]], 'seeds': [100, 102]})
        self.storage.delete_file.assert_called_once_with(self.urls[1])
        with self.sessions() as db:
            self.assertEqual(db.query(ChatMessage).filter_by(message_id='round').one().content, 'keep this prompt')
            self.assertEqual(db.query(ChatMessage).filter_by(session_id='session').count(), 2)
        self.assertEqual(self.delete([self.urls[1]]).json(), response.json(), 'retry is idempotent')

    def test_deleting_all_results_keeps_the_empty_round(self):
        self.assertEqual(self.delete(self.urls).json(), {'images': [], 'seeds': []})
        with self.sessions() as db:
            self.assertEqual(db.query(ChatMessage).filter_by(session_id='session').count(), 2)

    def test_files_used_in_other_results_or_input_drafts_are_not_unlinked(self):
        with self.sessions() as db:
            db.add(GeneratedImage(message_id='other-reply', image_index=0, file_path=self.urls[0]))
            db.query(ChatSession).filter_by(session_id='session').one().config_input_drafts = {'image': {'reference_images': [self.urls[1]]}}
            db.commit()
        self.assertEqual(self.delete(self.urls[:2]).status_code, 200)
        self.storage.delete_file.assert_not_called()

    def test_ownership_message_identity_and_active_task_are_checked(self):
        self.user_id = 2
        self.assertEqual(self.delete(self.urls).status_code, 404)
        self.user_id = 1
        self.assertEqual(self.delete(self.urls, message='other-reply').status_code, 404)
        self.assertEqual(self.delete(self.urls, message='round').status_code, 404)
        self.tasks.reserve(TaskContext(1, 'task', 'test', 'session', 'round-reply'))
        self.assertEqual(self.delete(self.urls).status_code, 409)
        self.storage.delete_file.assert_not_called()

    def test_empty_selection_is_rejected_and_arbitrary_paths_never_reach_cleanup(self):
        self.assertEqual(self.delete([]).status_code, 422)
        self.assertEqual(self.delete(['/uploads/../../secret', '/uploads/generated/2/other.png']).json()['images'], self.urls)
        self.storage.delete_file.assert_not_called()
