"""Agent sessions, posted rounds, slot and task status."""
import unittest

from agent_bridge_support import AgentApp, add_users, memory_database, temporary_storage
from server.api.session import router as session_router
from server.generation.contracts import TaskContext
from server.models import ChatMessage, ChatSession, GeneratedImage


class AgentRoundTests(unittest.TestCase):
    def setUp(self):
        self.engine, self.sessions = memory_database(self)
        add_users(self.sessions, 'one', 'two')
        self.storage = temporary_storage(self)
        self.app = AgentApp(self, self.sessions, routers=(session_router,))
        self.client = self.app.client

    def stored(self, user_id=1, name='a' * 32):
        path = self.storage.upload_dir / f'agent/{user_id}/202610/{name}.png'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'png')
        return f'/uploads/agent/{user_id}/202610/{name}.png'

    def new_session(self, title='Agent · 测试'):
        response = self.client.post('/api/agent/sessions', json={'title': title})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['session_id']

    def test_sessions_start_with_an_empty_composer_and_notify_open_tabs(self):
        session_id = self.new_session()
        self.assertTrue(session_id.startswith('session-'))
        with self.sessions() as db:
            session = db.query(ChatSession).filter_by(session_id=session_id).one()
            self.assertEqual((session.user_id, session.title, session.config_prompt), (1, 'Agent · 测试', ''))
        self.assertEqual(self.app.fields('agent_session'), [{'reason': 'session_created', 'session_id': session_id}])
        self.assertEqual(self.client.post('/api/agent/sessions', json={'title': ''}).status_code, 422)

    def test_posted_round_renders_like_a_result_and_announces_itself(self):
        session_id = self.new_session()
        media = [self.stored(name='a' * 32), self.stored(name='b' * 32)]
        response = self.client.post('/api/agent/rounds', json={'session_id': session_id, 'text': '去白边后的成品', 'media': media})
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body['reply_id'], body['message_id'] + '-reply')
        self.assertEqual(body['media'], media)
        messages = self.client.get(f"/api/chat/sessions/{session_id}/rounds/{body['reply_id']}").json()['messages']
        self.assertEqual([message['type'] for message in messages], ['user', 'assistant'])
        self.assertEqual(messages[0]['content'], '去白边后的成品')
        # Marked as the agent's: the UI shows the text on the agent's side, next to the media.
        self.assertEqual([message['params']['workflow'] for message in messages], ['agent_post', 'agent_post'])
        self.assertEqual(messages[1]['content'], '去白边后的成品')
        self.assertEqual(messages[1]['images'], media)
        self.assertEqual(self.app.fields('agent_session')[-1]['reason'], 'round_posted')

    def test_rounds_accept_only_the_callers_media_and_sessions(self):
        session_id = self.new_session()
        foreign = self.stored(user_id=2)
        self.assertEqual(self.client.post('/api/agent/rounds', json={'session_id': session_id, 'media': [foreign]}).status_code, 403)
        self.assertEqual(self.client.post('/api/agent/rounds', json={'session_id': session_id, 'media': ['/uploads/../x.png']}).status_code, 422)
        self.assertEqual(self.client.post('/api/agent/rounds', json={'session_id': session_id, 'media': []}).status_code, 422)
        self.app.user_id = 2
        self.assertEqual(self.client.post('/api/agent/rounds', json={'session_id': session_id, 'media': [foreign]}).status_code, 404)
        with self.sessions() as db:
            self.assertEqual(db.query(ChatMessage).count(), 0)

    def test_deleting_the_session_removes_posted_media(self):
        session_id = self.new_session()
        url = self.stored()
        self.client.post('/api/agent/rounds', json={'session_id': session_id, 'media': [url]})
        self.assertEqual(self.client.delete(f'/api/chat/sessions/{session_id}').status_code, 200)
        self.assertFalse((self.storage.upload_dir / url.removeprefix('/uploads/')).exists())
        with self.sessions() as db:
            self.assertEqual(db.query(GeneratedImage).count(), 0)

    def test_slot_reveals_details_only_to_the_owner(self):
        self.assertEqual(self.client.get('/api/agent/slot').json(), {'busy': False})
        task = self.app.tasks.reserve(TaskContext(1, 'task-1', 'qwen_image_21_t2i', 'session-x', 'msg-1-reply'))
        mine = self.client.get('/api/agent/slot').json()
        self.assertEqual((mine['busy'], mine['mine'], mine['task_id'], mine['phase']), (True, True, 'task-1', 'reserved'))
        self.app.user_id = 2
        self.assertEqual(self.client.get('/api/agent/slot').json(), {'busy': True, 'mine': False})
        self.app.tasks.finish(task, 'completed')

    def test_task_status_survives_newer_tasks_and_is_private(self):
        self.assertEqual(self.client.get('/api/agent/tasks/missing').status_code, 404)
        first = self.app.tasks.reserve(TaskContext(1, 'task-1', 'qwen_image_21_t2i', 'session-x', 'msg-1-reply'))
        self.assertEqual(self.client.get('/api/agent/tasks/task-1').json()['status'], 'running')
        first.artifacts.append('/uploads/generated/1/a.png')
        first.seeds.append(7)
        self.app.tasks.finish(first, 'completed')
        second = self.app.tasks.reserve(TaskContext(1, 'task-2', 'qwen_image_21_t2i', 'session-x', 'msg-2-reply'))
        self.app.tasks.finish(second, 'error', error='boom')
        snapshot = self.client.get('/api/agent/tasks/task-1').json()
        self.assertEqual((snapshot['status'], snapshot['images'], snapshot['seeds'], snapshot['artifact_count']),
                         ('completed', ['/uploads/generated/1/a.png'], [7], 1))
        self.assertEqual(self.client.get('/api/agent/tasks/task-2').json()['error'], 'boom')
        self.app.user_id = 2
        self.assertEqual(self.client.get('/api/agent/tasks/task-1').status_code, 404)


if __name__ == '__main__':
    unittest.main()
