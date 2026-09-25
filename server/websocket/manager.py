"""User-scoped connection delivery, independent of generation services."""
import json
import logging
from typing import Protocol

from server.generation.events import StateEvent

logger = logging.getLogger(__name__)


class Connection(Protocol):
    async def accept(self) -> None: ...
    async def send_text(self, data: str) -> None: ...


class ConnectionManager:
    def __init__(self):
        self.active_connections: set[Connection] = set()
        self.connection_sessions: dict[Connection, str] = {}
        self.connection_users: dict[Connection, int] = {}

    async def connect(self, websocket: Connection, *, user_id: int, session_id: str | None = None):
        await websocket.accept()
        self.active_connections.add(websocket)
        self.connection_users[websocket] = user_id
        if session_id:
            self.connection_sessions[websocket] = session_id

    def disconnect(self, websocket: Connection):
        self.active_connections.discard(websocket)
        self.connection_sessions.pop(websocket, None)
        self.connection_users.pop(websocket, None)

    async def publish(self, event: StateEvent) -> None:
        message = json.dumps(event.payload(), ensure_ascii=False)
        # A disconnect can mutate the live set while another send is awaiting IO.
        recipients = tuple(
            connection for connection in self.active_connections
            if event.user_id is None or self.connection_users.get(connection) == event.user_id
        )
        for connection in recipients:
            try:
                await connection.send_text(message)
            except Exception:
                logger.debug("WebSocket disconnected during delivery", exc_info=True)
                self.disconnect(connection)
