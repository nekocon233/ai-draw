"""Application service: scheduling, cancellation and durable result replacement."""
import asyncio
import logging
from typing import Callable, Optional, Protocol

from .contracts import GenerationParameters, TaskContext
from .events import EventPublisher
from .tasks import GenerationTask, TaskManager

logger = logging.getLogger(__name__)


class MediaGenerator(Protocol):
    def validate(self, parameters: GenerationParameters) -> None: ...

    async def generate(
        self, parameters: GenerationParameters, context: TaskContext,
        on_artifact: Callable[[str, int, int, Optional[int]], None], check_cancelled: Callable[[], None],
    ) -> list[str]: ...

    async def interrupt(self, workflow: str, runner: asyncio.Task) -> None: ...


class ResultRepository(Protocol):
    def persist(
        self, context: TaskContext, images: list[str], *, replace_existing: bool = True,
        source_updates: Optional[dict] = None, seeds: Optional[list[Optional[int]]] = None,
    ) -> str: ...

    def discard(self, images: list[str]) -> None: ...


class GenerationCoordinator:
    def __init__(self, engine: MediaGenerator, repository: ResultRepository, events: EventPublisher, tasks: Optional[TaskManager] = None):
        self.engine = engine
        self.repository = repository
        self.events = events
        self.tasks = tasks if tasks is not None else TaskManager()

    def reserve(self, context: TaskContext, parameters: GenerationParameters) -> GenerationTask:
        if context.workflow != parameters.workflow:
            raise ValueError("任务工作流与生成参数不一致")
        self.engine.validate(parameters)
        return self.tasks.reserve(context)

    def abort_submission(self, task: GenerationTask) -> None:
        self.tasks.finish(task, "error", error="生成任务调度失败")
        self.events.task(task.context, "error", "生成任务调度失败")

    async def _persist(self, task: GenerationTask, parameters: GenerationParameters, *, final: bool) -> None:
        if not task.context.message_id or not task.context.session_id:
            return
        status = "failed"
        for attempt in range(2):
            writer = asyncio.create_task(asyncio.to_thread(
                self.repository.persist, task.context, list(task.artifacts) if final else [],
                replace_existing=final,
                source_updates=parameters.source_updates() if final else None,
                seeds=list(task.seeds) if final else [],
            ))
            try:
                status = await asyncio.shield(writer)
            except asyncio.CancelledError:
                # A database thread cannot be cancelled. Wait for its authoritative outcome.
                status = await writer
                if not final:
                    raise
            if status != "failed":
                break
            if attempt == 0:
                await asyncio.sleep(0.25)
        if status == "target_missing":
            raise RuntimeError("生成结果对应的消息已被删除")
        if status != "persisted":
            raise RuntimeError("生成结果持久化失败" if final else "生成任务占位写入失败")

    async def run(self, task: GenerationTask, parameters: GenerationParameters) -> None:
        phase = "completed"
        error = None
        try:
            self.tasks.start(task)
            self.events.task(task.context, "is_generating", True)
            self.events.task(task.context, "generation_progress", "正在生成...")
            await self._persist(task, parameters, final=False)
            self.tasks.check_cancelled(task)

            prepare = getattr(self.engine, 'prepare', None)
            if prepare is not None:
                parameters = await prepare(parameters, lambda text: self.events.task(task.context, "generation_progress", text))
                self.tasks.check_cancelled(task)
                self.events.task(task.context, "generation_progress", "正在生成...")

            def on_artifact(url: str, index: int, total: int, seed: Optional[int] = None):
                task.artifacts.append(url)
                task.seeds.append(seed)
                self.events.task(task.context, "media_generated", {"image": url, "index": index, "total": total, "seed": seed})
                self.events.task(task.context, "preview_update", {
                    "action": "add",
                    "data": {"id": index + 1, "image": url, "workflow": task.context.workflow, "seed": seed},
                })

            await self.engine.generate(
                parameters, task.context, on_artifact, lambda: self.tasks.check_cancelled(task),
            )
            self.tasks.begin_persistence(task)
            await self._persist(task, parameters, final=True)
        except asyncio.CancelledError:
            phase, error = "cancelled", "生成任务已取消"
        except Exception as exception:
            logger.exception("Generation task failed: %s", task.context.task_id)
            phase, error = "error", str(exception)
        finally:
            if phase != "completed":
                try:
                    await asyncio.to_thread(self.repository.discard, list(task.artifacts))
                    # Preserve an existing successful round; create a placeholder only if needed.
                    await self._persist(task, parameters, final=False)
                except Exception:
                    logger.exception("Failed to clean up generation task %s", task.context.task_id)
            self.tasks.finish(task, phase, error=error)
            if error:
                self.events.task(task.context, "generation_progress", error)
                self.events.task(task.context, "error", error)
            else:
                self.events.task(task.context, "generation_progress", "生成完成")
                self.events.task(task.context, "is_generating", False)

    async def stop(self, user_id: int, task_id: Optional[str] = None) -> bool:
        task, first_request = self.tasks.request_cancel(user_id, task_id)
        if task is None:
            return False
        runner = task.runner
        if runner is not None and first_request:
            try:
                await self.engine.interrupt(task.context.workflow, runner)
            except Exception:
                logger.exception("Provider cancellation failed")
            finally:
                if self.tasks.active is task and task.phase == "running" and not runner.done():
                    runner.cancel()
        # Reserved tasks have no coroutine yet; run() will observe the cancellation.
        if runner is not None:
            await task.finished.wait()
        return True

    def snapshot(self, user_id: int) -> dict:
        active = self.tasks.active
        owns_task = active is not None and active.context.user_id == user_id
        return {
            "is_generating": owns_task,
            "preview_items": [
                {"id": index + 1, "image": url, "workflow": active.context.workflow, "seed": seed}
                for index, (url, seed) in enumerate(zip(active.artifacts, active.seeds))
            ] if owns_task else [],
            "last_task": self.tasks.last_task(user_id),
        }
