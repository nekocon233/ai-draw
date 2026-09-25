"""Own the single generation slot without mixing it with provider or HTTP state."""
import asyncio
import time
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Callable, Literal, Optional

from .contracts import TaskContext

Phase = Literal["reserved", "running", "persisting", "completed", "error", "cancelled"]


class TaskBusyError(RuntimeError):
    pass


class TaskOwnershipError(RuntimeError):
    pass


class TaskConflictError(RuntimeError):
    pass


@dataclass
class GenerationTask:
    context: TaskContext
    phase: Phase = "reserved"
    cancel_requested: bool = False
    runner: Optional[asyncio.Task] = None
    artifacts: list[str] = field(default_factory=list)
    finished: asyncio.Event = field(default_factory=asyncio.Event)


class TaskManager:
    """All slot transitions are synchronous and run on the FastAPI event loop."""

    def __init__(self, *, clock: Callable[[], float] = time.time, retention: float = 1800, limit: int = 256):
        self._active: Optional[GenerationTask] = None
        self._recent: dict[int, dict] = {}
        self._clock = clock
        self._retention = retention
        self._limit = limit

    @property
    def active(self) -> Optional[GenerationTask]:
        return self._active

    def reserve(self, context: TaskContext) -> GenerationTask:
        if self._active is not None:
            raise TaskBusyError("已有生成任务正在运行")
        task = GenerationTask(context)
        self._active = task
        self._prune()
        return task

    def start(self, task: GenerationTask) -> None:
        self._require_active(task)
        if task.phase != "reserved":
            raise TaskConflictError("生成任务已经启动")
        task.runner = asyncio.current_task()
        task.phase = "running"
        self.check_cancelled(task)

    def check_cancelled(self, task: GenerationTask) -> None:
        self._require_active(task)
        if task.cancel_requested:
            raise asyncio.CancelledError

    def begin_persistence(self, task: GenerationTask) -> None:
        self.check_cancelled(task)
        task.phase = "persisting"

    def request_cancel(self, user_id: int, task_id: Optional[str] = None) -> tuple[Optional[GenerationTask], bool]:
        task = self._active
        if task is None:
            return None, False
        if task.context.user_id != user_id:
            raise TaskOwnershipError("不能停止其他用户的生成任务")
        if task_id and task.context.task_id != task_id:
            raise TaskConflictError("生成任务已变更，请刷新任务状态")
        if task.phase == "persisting":
            raise TaskConflictError("生成结果正在保存，无法停止")
        first_request = not task.cancel_requested
        task.cancel_requested = True
        return task, first_request

    def finish(self, task: GenerationTask, phase: Phase, *, error: Optional[str] = None) -> None:
        self._require_active(task)
        if phase not in ("completed", "error", "cancelled"):
            raise ValueError("Expected a terminal task phase")
        task.phase = phase
        snapshot = self._snapshot(task)
        snapshot.update(error=error, finished_at=self._clock())
        self._recent.pop(task.context.user_id, None)
        self._recent[task.context.user_id] = snapshot
        self._active = None
        task.runner = None
        task.finished.set()
        self._prune()

    def last_task(self, user_id: int) -> Optional[dict]:
        if self._active and self._active.context.user_id == user_id:
            return self._snapshot(self._active)
        self._prune()
        return deepcopy(self._recent.get(user_id))

    def _snapshot(self, task: GenerationTask) -> dict:
        context = task.context
        return {
            "task_id": context.task_id,
            "user_id": context.user_id,
            "session_id": context.session_id,
            "message_id": context.message_id,
            "workflow": context.workflow,
            # Keep the existing reconnect contract; phase distinguishes cancellation.
            "status": "completed" if task.phase == "completed" else (
                "error" if task.phase in ("error", "cancelled") else "running"
            ),
            "phase": task.phase,
            "images": list(task.artifacts) if task.phase == "completed" else [],
            "error": None,
            "finished_at": None,
        }

    def _require_active(self, task: GenerationTask) -> None:
        if self._active is not task:
            raise TaskConflictError("生成任务已经结束或已被替换")

    def _prune(self) -> None:
        now = self._clock()
        expired = [user for user, item in self._recent.items() if now - item["finished_at"] >= self._retention]
        for user in expired:
            del self._recent[user]
        while len(self._recent) > self._limit:
            del self._recent[next(iter(self._recent))]
