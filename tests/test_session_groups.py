"""Project folders are owned metadata: organising them must never delete a round or change activity."""
import unittest
import os
import uuid
from datetime import datetime
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from server.api.session import router as session_router
from server.api.user import router as user_router
from server.auth import get_current_user
from server.database import Base, get_db, migrate_session_groups
from server.models import ChatMessage, ChatSession, ChatSessionGroup, GeneratedImage, User, UserConfig


class SessionGroupTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)

        @event.listens_for(self.engine, 'connect')
        def foreign_keys(connection, _record):
            connection.execute('PRAGMA foreign_keys=ON')

        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.old_time = datetime(2020, 1, 1)
        with self.sessions() as db:
            db.add_all([User(id=1, username='owner', password_hash='x'), User(id=2, username='other', password_hash='x')])
            db.flush()
            db.add(UserConfig(user_id=1, current_workflow='gpt_image', count=1, images_per_row=4, current_session_id='old'))
            db.add_all([
                ChatSession(user_id=1, session_id='old', title='已有对话', is_pinned=True,
                            updated_at=self.old_time, config_input_drafts={'image': {'prompt': 'unsent'}}),
                ChatSession(user_id=2, session_id='foreign', title='别人的对话'),
            ])
            db.flush()
            db.add(ChatMessage(user_id=1, session_id='old', message_id='reply', type='assistant', content='保留'))
            db.flush()
            db.add(GeneratedImage(message_id='reply', image_index=0, file_path='/uploads/generated/1/keep.png', seed=123))
            db.commit()
        self.user_id = 1
        app = self.app = FastAPI()
        app.include_router(session_router, prefix='/api')
        app.include_router(user_router, prefix='/api')

        def database():
            with self.sessions() as db:
                yield db

        app.dependency_overrides[get_db] = database
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=self.user_id, username='owner')
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def group(self, name='项目 A'):
        response = self.client.post('/api/chat/session-groups', json={'name': name})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def move(self, group_id, session_id='old'):
        return self.client.patch(f'/api/chat/sessions/{session_id}/group', json={'group_id': group_id})

    def test_create_rename_pin_collapse_and_sort_groups(self):
        first, second = self.group('  项目 A  '), self.group('项目 B')
        self.assertEqual(first['name'], '项目 A')
        self.assertFalse(first['is_collapsed'])
        response = self.client.patch(f"/api/chat/session-groups/{second['id']}", json={
            'name': '新项目', 'is_pinned': True, 'is_collapsed': True,
        })
        self.assertEqual(response.status_code, 200, response.text)
        groups = self.client.get('/api/chat/session-groups').json()
        self.assertEqual([item['id'] for item in groups], [second['id'], first['id']])
        self.assertEqual((groups[0]['name'], groups[0]['is_collapsed']), ('新项目', True))
        self.assertEqual(groups[0]['created_at'], second['created_at'])
        for name in ('', '  ', 'a' * 101):
            self.assertEqual(self.client.post('/api/chat/session-groups', json={'name': name}).status_code, 422)
            self.assertEqual(self.client.patch(f"/api/chat/session-groups/{first['id']}", json={'name': name}).status_code, 422)

    def test_legacy_sessions_and_creation_with_or_without_a_group(self):
        self.assertIsNone(self.client.get('/api/chat/sessions').json()[0]['group_id'])
        group = self.group()
        self.client.patch(f"/api/chat/session-groups/{group['id']}", json={'is_collapsed': True})
        response = self.client.post('/api/chat/sessions', json={'session_id': 'new', 'group_id': group['id']})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['group_id'], group['id'])
        self.assertFalse(self.client.get('/api/chat/session-groups').json()[0]['is_collapsed'])
        self.client.post('/api/config/user', json={'ungrouped_collapsed': True})
        response = self.client.post('/api/chat/sessions', json={'session_id': 'plain'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json()['group_id'])
        self.assertFalse(self.client.get('/api/config/user').json()['ungrouped_collapsed'])

    def test_moves_expand_destination_without_changing_input_activity_or_pin(self):
        group = self.group()
        self.client.patch(f"/api/chat/session-groups/{group['id']}", json={'is_collapsed': True})
        self.assertEqual(self.move(group['id']).json(), {'group_id': group['id']})
        self.assertFalse(self.client.get('/api/chat/session-groups').json()[0]['is_collapsed'])
        self.client.post('/api/config/user', json={'ungrouped_collapsed': True})
        self.assertEqual(self.move(None).json(), {'group_id': None})
        self.assertFalse(self.client.get('/api/config/user').json()['ungrouped_collapsed'])
        self.client.patch('/api/chat/sessions/old/pin', json={'is_pinned': False})
        with self.sessions() as db:
            session = db.query(ChatSession).filter_by(session_id='old').one()
            self.assertEqual(session.updated_at, self.old_time)
            self.assertEqual(session.config_input_drafts, {'image': {'prompt': 'unsent'}})
            self.assertFalse(session.is_pinned)
            self.assertEqual(db.query(UserConfig).filter_by(user_id=1).one().current_session_id, 'old')

    def test_deleting_group_keeps_sessions_rounds_media_seeds_and_input(self):
        group = self.group()
        self.move(group['id'])
        response = self.client.delete(f"/api/chat/session-groups/{group['id']}")
        self.assertEqual(response.status_code, 200, response.text)
        with self.sessions() as db:
            self.assertEqual(db.query(ChatSessionGroup).count(), 0)
            session = db.query(ChatSession).filter_by(session_id='old').one()
            self.assertIsNone(session.group_id)
            self.assertEqual(session.updated_at, self.old_time)
            self.assertTrue(session.is_pinned)
            self.assertEqual(session.config_input_drafts, {'image': {'prompt': 'unsent'}})
            self.assertEqual(db.query(ChatMessage).one().content, '保留')
            image = db.query(GeneratedImage).one()
            self.assertEqual((image.file_path, image.seed), ('/uploads/generated/1/keep.png', 123))

    def test_database_foreign_key_also_only_unassigns_on_delete(self):
        group = self.group()
        self.move(group['id'])
        with self.engine.begin() as conn:
            conn.execute(text('DELETE FROM chat_session_groups WHERE id = :id'), {'id': group['id']})
        with self.sessions() as db:
            session = db.query(ChatSession).filter_by(session_id='old').one()
            self.assertIsNone(session.group_id)
            self.assertEqual(session.updated_at, self.old_time)
            self.assertEqual(db.query(GeneratedImage).count(), 1)

    def test_cross_user_and_missing_targets_are_not_found_and_cannot_be_assigned(self):
        mine = self.group()
        self.user_id = 2
        other = self.group('私有项目')
        self.user_id = 1
        self.assertEqual([g['id'] for g in self.client.get('/api/chat/session-groups').json()], [mine['id']])
        for group_id in (other['id'], 99999):
            self.assertEqual(self.move(group_id).status_code, 404)
            self.assertEqual(self.client.patch(f'/api/chat/session-groups/{group_id}', json={'name': '无权'}).status_code, 404)
            self.assertEqual(self.client.delete(f'/api/chat/session-groups/{group_id}').status_code, 404)
            self.assertEqual(self.client.post('/api/chat/sessions', json={
                'session_id': 'attempt', 'group_id': group_id,
            }).status_code, 404)
        self.assertEqual(self.move(mine['id'], 'foreign').status_code, 404)
        self.assertEqual(self.move(None, 'foreign').status_code, 404)
        self.assertEqual(self.move(mine['id'], 'missing').status_code, 404)
        self.assertEqual(self.client.patch('/api/chat/sessions/old/group', json={}).status_code, 422)
        with self.sessions() as db:
            self.assertIsNone(db.query(ChatSession).filter_by(session_id='old').one().group_id)

    def test_ungrouped_state_persists_without_overwriting_other_config(self):
        self.assertEqual(self.client.post('/api/config/user', json={'ungrouped_collapsed': True}).status_code, 200)
        self.client.post('/api/config/user', json={'images_per_row': 2})
        config = self.client.get('/api/config/user').json()
        self.assertTrue(config['ungrouped_collapsed'])
        self.assertEqual((config['current_session_id'], config['images_per_row']), ('old', 2))
        self.assertEqual(self.client.post('/api/config/user', json={'ungrouped_collapsed': None}).status_code, 422)

    def test_group_operations_require_authentication(self):
        self.app.dependency_overrides.pop(get_current_user)
        for method, path, payload in (
            ('get', '/api/chat/session-groups', None),
            ('post', '/api/chat/session-groups', {'name': 'x'}),
            ('patch', '/api/chat/session-groups/1', {'is_pinned': True}),
            ('delete', '/api/chat/session-groups/1', None),
            ('patch', '/api/chat/sessions/old/group', {'group_id': None}),
        ):
            with self.subTest(method=method, path=path):
                self.assertEqual(self.client.request(method, path, json=payload).status_code, 401)


@unittest.skipUnless(os.environ.get('SESSION_GROUPS_TEST_DATABASE_URL'), 'requires an isolated PostgreSQL test database')
class SessionGroupMigrationTests(unittest.TestCase):
    def test_old_schema_migrates_twice_and_foreign_key_preserves_sessions(self):
        engine = create_engine(os.environ['SESSION_GROUPS_TEST_DATABASE_URL'])
        self.addCleanup(engine.dispose)
        # Always use a fresh schema in a rolled-back transaction, even with an externally supplied test URL.
        with engine.connect() as conn:
            transaction = conn.begin()
            schema = 'session_groups_test_' + uuid.uuid4().hex
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))
            conn.execute(text(f'SET LOCAL search_path TO "{schema}"'))
            conn.execute(text('CREATE TABLE users (id INTEGER PRIMARY KEY)'))
            conn.execute(text('CREATE TABLE user_configs (id INTEGER PRIMARY KEY, user_id INTEGER)'))
            conn.execute(text('CREATE TABLE chat_sessions (id INTEGER PRIMARY KEY, session_id VARCHAR(50), updated_at TIMESTAMP)'))
            conn.execute(text("INSERT INTO users VALUES (1)"))
            conn.execute(text("INSERT INTO user_configs VALUES (1, 1)"))
            conn.execute(text("INSERT INTO chat_sessions VALUES (1, 'legacy', '2020-01-01')"))
            ChatSessionGroup.__table__.create(conn)
            migrate_session_groups(conn)
            migrate_session_groups(conn)
            self.assertIsNone(conn.execute(text('SELECT group_id FROM chat_sessions')).scalar())
            self.assertFalse(conn.execute(text('SELECT ungrouped_collapsed FROM user_configs')).scalar())
            foreign_key = inspect(conn).get_foreign_keys('chat_sessions')[0]
            self.assertEqual(foreign_key['options']['ondelete'], 'SET NULL')
            self.assertIn('ix_chat_sessions_group_id', [index['name'] for index in inspect(conn).get_indexes('chat_sessions')])
            group_id = conn.execute(ChatSessionGroup.__table__.insert().values(user_id=1, name='项目')).inserted_primary_key[0]
            conn.execute(text('UPDATE chat_sessions SET group_id = :id'), {'id': group_id})
            conn.execute(text('DELETE FROM chat_session_groups WHERE id = :id'), {'id': group_id})
            row = conn.execute(text('SELECT session_id, updated_at, group_id FROM chat_sessions')).one()
            self.assertEqual(tuple(row), ('legacy', datetime(2020, 1, 1), None))
            transaction.rollback()


if __name__ == '__main__':
    unittest.main()
