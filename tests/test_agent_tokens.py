"""Agent access tokens: hashed at rest, revocable, and accepted wherever a JWT is."""
import contextlib
import io
import json
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

from agent_bridge_support import AgentApp, add_users, memory_database
from server.agent_bridge import tokens
from server.auth import create_access_token, get_user_from_token
from server.models import AgentAccessToken, User


class AgentTokenTests(unittest.TestCase):
    def setUp(self):
        self.engine, self.sessions = memory_database(self)
        add_users(self.sessions, 'owner', 'other')

    def issue(self, username='owner', days=90, now=None):
        with self.sessions() as db:
            user = db.query(User).filter_by(username=username).one()
            record, token = tokens.issue_token(db, user, 'claude', days, now=now)
            return record.id, token

    def test_token_resolves_owner_and_is_stored_only_as_a_hash(self):
        _, token = self.issue()
        self.assertTrue(token.startswith(tokens.PAT_PREFIX))
        with self.sessions() as db:
            self.assertEqual(tokens.user_for_access_token(db, token).username, 'owner')
            record = db.query(AgentAccessToken).one()
            self.assertNotIn(token, (record.token_hash, record.token_prefix, record.name))
            self.assertEqual(record.token_hash, tokens.hash_token(token))
            self.assertIsNone(tokens.user_for_access_token(db, token + 'x'))
            self.assertIsNone(tokens.user_for_access_token(db, 'aidp_' + 'x' * 200))

    def test_last_use_is_recorded_at_most_every_ten_minutes(self):
        start = datetime(2026, 10, 1, 12, 0)
        _, token = self.issue(now=start)
        with self.sessions() as db:
            tokens.user_for_access_token(db, token, now=start)
            tokens.user_for_access_token(db, token, now=start + timedelta(minutes=5))
            self.assertEqual(db.query(AgentAccessToken).one().last_used_at, start)
            tokens.user_for_access_token(db, token, now=start + timedelta(minutes=11))
            self.assertEqual(db.query(AgentAccessToken).one().last_used_at, start + timedelta(minutes=11))

    def test_revoked_expired_and_inactive_owners_are_rejected(self):
        start = datetime(2026, 10, 1)
        token_id, token = self.issue(days=1, now=start)
        with self.sessions() as db:
            self.assertIsNotNone(tokens.user_for_access_token(db, token, now=start + timedelta(hours=23)))
            self.assertIsNone(tokens.user_for_access_token(db, token, now=start + timedelta(days=1)))
        _, forever = self.issue(days=None)
        with self.sessions() as db:
            self.assertIsNotNone(tokens.user_for_access_token(db, forever, now=datetime(2099, 1, 1)))
            db.query(User).filter_by(username='owner').one().is_active = False
            db.commit()
            self.assertIsNone(tokens.user_for_access_token(db, forever))
            db.query(User).filter_by(username='owner').one().is_active = True
            db.query(AgentAccessToken).filter(AgentAccessToken.id != token_id).one().revoked_at = datetime.now()
            db.commit()
            self.assertIsNone(tokens.user_for_access_token(db, forever))

    def test_jwt_path_is_unchanged_and_both_reach_http_routes(self):
        _, token = self.issue()
        jwt = create_access_token({'sub': 'other'})
        with self.sessions() as db:
            self.assertEqual(get_user_from_token(token, db).username, 'owner')
            self.assertEqual(get_user_from_token(jwt, db).username, 'other')
            self.assertIsNone(get_user_from_token('not-a-token', db))
        client = AgentApp(self, self.sessions, user_id=None).client
        self.assertEqual(client.get('/api/agent/me', headers={'Authorization': f'Bearer {token}'}).json()['username'], 'owner')
        self.assertEqual(client.get('/api/agent/me', headers={'Authorization': f'Bearer {jwt}'}).json()['username'], 'other')
        self.assertEqual(client.get('/api/agent/me', headers={'Authorization': 'Bearer aidp_wrong'}).status_code, 401)
        self.assertEqual(client.get('/api/agent/me').status_code, 401)

    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with patch('server.database.SessionLocal', self.sessions), patch('server.database.engine', self.engine), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = tokens.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def test_management_command_shows_the_secret_only_on_creation(self):
        code, out, _ = self.run_cli('create', '--user', 'owner', '--name', 'codex', '--days', '30')
        self.assertEqual(code, 0)
        created = json.loads(out)
        self.assertEqual((created['user'], created['name']), ('owner', 'codex'))
        with self.sessions() as db:
            self.assertEqual(tokens.user_for_access_token(db, created['token']).username, 'owner')
        code, out, _ = self.run_cli('list')
        self.assertNotIn(created['token'], out)
        self.assertEqual(json.loads(out)[0]['prefix'], created['prefix'])
        self.assertEqual(json.loads(self.run_cli('users')[1])[0]['username'], 'owner')
        self.assertEqual(self.run_cli('create', '--user', 'nobody')[0], 1)
        code, out, _ = self.run_cli('revoke', '--prefix', created['prefix'])
        self.assertEqual(code, 0)
        self.assertIsNotNone(json.loads(out)['revoked_at'])
        with self.sessions() as db:
            self.assertIsNone(tokens.user_for_access_token(db, created['token']))


if __name__ == '__main__':
    unittest.main()
