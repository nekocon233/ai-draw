"""Shared setup for the agent bridge tests: SQLite with foreign keys, temporary uploads and a test app."""
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from server.ai_draw_service import get_ai_draw_service
from server.api.agent import router as agent_router
from server.auth import get_current_user
from server.database import Base, get_db
from server.generation.events import EventPublisher
from server.generation.tasks import TaskManager
from server.models import ChatMessage, ChatSession, GeneratedImage, User
from utils.file_storage import FileStorage


def memory_database(test):
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)

    @event.listens_for(engine, 'connect')
    def enable_foreign_keys(connection, _record):
        # Gates rely on ON DELETE CASCADE, which SQLite only honours with this pragma.
        connection.execute('PRAGMA foreign_keys=ON')

    test.addCleanup(engine.dispose)
    Base.metadata.create_all(engine)
    return engine, sessionmaker(bind=engine, expire_on_commit=False)


def temporary_storage(test):
    directory = tempfile.TemporaryDirectory()
    test.addCleanup(directory.cleanup)
    storage = FileStorage.__new__(FileStorage)
    storage.upload_dir = Path(directory.name)
    storage.generated_dir = storage.upload_dir / 'generated'
    storage.reference_dir = storage.upload_dir / 'reference'
    for target in ('server.agent_bridge.uploads.get_file_storage', 'utils.media_file_references.get_file_storage'):
        patcher = patch(target, return_value=storage)
        patcher.start()
        test.addCleanup(patcher.stop)
    return storage


def add_users(sessions, *names):
    with sessions() as db:
        for index, name in enumerate(names, start=1):
            db.add(User(id=index, username=name, password_hash='x'))
        db.commit()


def add_round(sessions, session_id, user_id, message_id, urls, create_session=False):
    """A user message and its reply holding the given media."""
    with sessions() as db:
        if create_session:
            db.add(ChatSession(session_id=session_id, user_id=user_id))
            db.flush()
        db.add_all([
            ChatMessage(session_id=session_id, user_id=user_id, message_id=message_id, type='user', content='prompt'),
            ChatMessage(session_id=session_id, user_id=user_id, message_id=f'{message_id}-reply', type='assistant'),
        ])
        db.flush()
        db.add_all([
            GeneratedImage(message_id=f'{message_id}-reply', image_index=index, file_path=url, seed=100 + index)
            for index, url in enumerate(urls)
        ])
        db.commit()


class AgentApp:
    """The agent router (plus optional others) with captured events; `user_id=None` keeps real auth."""

    def __init__(self, test, sessions, user_id=1, routers=()):
        self.events = []
        publisher = EventPublisher()
        publisher.subscribe(self.events.append)
        self.tasks = TaskManager()
        self.service = SimpleNamespace(events=publisher, generation=SimpleNamespace(tasks=self.tasks))
        self.user_id = user_id
        app = FastAPI()
        app.include_router(agent_router, prefix='/api')
        for router in routers:
            app.include_router(router, prefix='/api')

        def database():
            with sessions() as db:
                yield db

        app.dependency_overrides[get_db] = database
        app.dependency_overrides[get_ai_draw_service] = lambda: self.service
        if user_id is not None:
            app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=self.user_id, username=f'user{self.user_id}')
        self.client = TestClient(app)
        test.addCleanup(self.client.close)

    def fields(self, name):
        return [event.value for event in self.events if event.field == name]
