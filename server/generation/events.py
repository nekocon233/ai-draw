"""Explicit event recipients; task identity is captured before asynchronous delivery."""
import logging
from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Callable, Optional

from .contracts import TaskContext

logger = logging.getLogger(__name__)
PUBLIC_FIELDS = frozenset({"is_service_available", "workflow_type"})


@dataclass(frozen=True)
class StateEvent:
    field: str
    value: Any
    user_id: Optional[int]
    context: Optional[TaskContext] = None

    def __post_init__(self):
        if self.user_id is None and self.field not in PUBLIC_FIELDS:
            raise ValueError("Private state requires a recipient")
        if self.context and self.context.user_id != self.user_id:
            raise ValueError("Event recipient does not own the task")

    def payload(self) -> dict:
        result = {"type": "state_change", "field": self.field, "value": deepcopy(self.value)}
        if self.context:
            result.update(
                task_id=self.context.task_id,
                session_id=self.context.session_id,
                message_id=self.context.message_id,
            )
        return result


class EventPublisher:
    def __init__(self):
        self._listeners: list[Callable[[StateEvent], None]] = []

    def subscribe(self, listener: Callable[[StateEvent], None]) -> Callable[[], None]:
        self._listeners.append(listener)

        def unsubscribe():
            if listener in self._listeners:
                self._listeners.remove(listener)

        return unsubscribe

    def emit(self, event: StateEvent) -> None:
        for listener in tuple(self._listeners):
            try:
                listener(event)
            except Exception:
                logger.exception("State event delivery failed")

    def task(self, context: TaskContext, field: str, value: Any) -> None:
        self.emit(StateEvent(field, deepcopy(value), context.user_id, context))

    def user(self, user_id: int, field: str, value: Any) -> None:
        self.emit(StateEvent(field, deepcopy(value), user_id))

    def public(self, field: str, value: Any) -> None:
        self.emit(StateEvent(field, deepcopy(value), None))
