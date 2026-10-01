import asyncio
import json
import threading
import unittest
from unittest.mock import AsyncMock

from server.generation.contracts import GenerationParameters, TaskContext
from server.generation.coordinator import GenerationCoordinator
from server.generation.events import EventPublisher, StateEvent
from server.generation.tasks import TaskBusyError, TaskConflictError, TaskManager, TaskOwnershipError
from server.websocket.manager import ConnectionManager


def context(user=1, task="task-a"):
    return TaskContext(user, task, "test", "session-a", "message-reply")


class TaskManagerTests(unittest.IsolatedAsyncioTestCase):
    async def test_reservation_prevents_context_overwrite_before_worker_starts(self):
        manager = TaskManager()
        original = manager.reserve(context())
        with self.assertRaises(TaskBusyError):
            manager.reserve(context(2, "other"))
        self.assertIs(manager.active, original)
        self.assertIsNone(manager.last_task(2))
        self.assertEqual(manager.last_task(1)["phase"], "reserved")

    async def test_stop_checks_owner_and_task_identity(self):
        manager = TaskManager()
        task = manager.reserve(context())
        with self.assertRaises(TaskOwnershipError):
            manager.request_cancel(2, "task-a")
        with self.assertRaises(TaskConflictError):
            manager.request_cancel(1, "old-task")
        self.assertFalse(task.cancel_requested)
        self.assertTrue(manager.request_cancel(1, "task-a")[1])
        self.assertFalse(manager.request_cancel(1, "task-a")[1])

    async def test_terminal_snapshot_is_owned_copied_and_expires(self):
        clock = [10.0]
        manager = TaskManager(clock=lambda: clock[0], retention=30, limit=1)
        task = manager.reserve(context())
        task.artifacts.append("/uploads/generated/1/image.png")
        manager.finish(task, "completed")
        snapshot = manager.last_task(1)
        snapshot["images"].clear()
        self.assertEqual(len(manager.last_task(1)["images"]), 1)
        self.assertIsNone(manager.last_task(2))
        clock[0] += 30
        self.assertIsNone(manager.last_task(1))

    async def test_old_task_cannot_release_a_new_reservation(self):
        manager = TaskManager()
        old = manager.reserve(context())
        manager.finish(old, "error", error="failed")
        new = manager.reserve(context(2, "new"))
        with self.assertRaises(TaskConflictError):
            manager.finish(old, "completed")
        self.assertIs(manager.active, new)

    async def test_persistence_cannot_be_cancelled(self):
        manager = TaskManager()
        task = manager.reserve(context())
        manager.start(task)
        manager.begin_persistence(task)
        with self.assertRaises(TaskConflictError):
            manager.request_cancel(1)
        self.assertFalse(task.cancel_requested)


class FakeRepository:
    def __init__(self):
        self.images = ["old-result"]
        self.discarded = []
        self.final_started = None
        self.final_release = None
        self.status = "persisted"

    def persist(self, task_context, images, *, replace_existing=True, source_updates=None, seeds=None):
        if replace_existing:
            if self.final_started:
                self.final_started.set()
                if not self.final_release.wait(3):
                    raise RuntimeError("Test commit was not released")
            if self.status == "persisted":
                self.images = list(images)
            return self.status
        return "persisted"

    def discard(self, images):
        self.discarded.extend(images)


class FakeEngine:
    def __init__(self):
        self.started = asyncio.Event()
        self.release = None
        self.fail = False
        self.interrupt = AsyncMock()

    def validate(self, parameters):
        if parameters.workflow != "test":
            raise ValueError("unknown workflow")

    async def generate(self, parameters, task_context, on_artifact, check_cancelled):
        self.started.set()
        if self.release:
            await self.release.wait()
        check_cancelled()
        on_artifact("new-result", 0, 1)
        if self.fail:
            raise RuntimeError("provider failed after a partial batch")
        return ["new-result"]


class CoordinatorTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.engine = FakeEngine()
        self.repository = FakeRepository()
        self.publisher = EventPublisher()
        self.events = []
        self.publisher.subscribe(self.events.append)
        self.service = GenerationCoordinator(self.engine, self.repository, self.publisher)
        self.parameters = GenerationParameters("prompt", workflow="test")

    def reserve(self):
        return self.service.reserve(context(), self.parameters)

    async def test_success_persists_before_terminal_event_and_works_without_clients(self):
        task = self.reserve()
        await self.service.run(task, self.parameters)
        self.assertEqual(self.repository.images, ["new-result"])
        self.assertEqual(self.service.snapshot(1)["last_task"]["status"], "completed")
        self.assertIsNone(self.service.snapshot(2)["last_task"])
        self.assertFalse(self.service.snapshot(1)["is_generating"])
        self.assertEqual(self.events[-1].field, "is_generating")
        self.assertFalse(self.events[-1].value)
        self.assertTrue(all(event.user_id == 1 and event.context == task.context for event in self.events))
        self.assertIsNone(self.service.tasks.active)

    async def test_partial_failure_cleans_files_and_preserves_previous_result(self):
        self.engine.fail = True
        with self.assertLogs("server.generation.coordinator", level="ERROR"):
            await self.service.run(self.reserve(), self.parameters)
        self.assertEqual(self.repository.images, ["old-result"])
        self.assertEqual(self.repository.discarded, ["new-result"])
        self.assertEqual(self.service.snapshot(1)["last_task"]["status"], "error")

    async def test_cancel_before_background_start_does_not_call_provider(self):
        task = self.reserve()
        await self.service.stop(1, "task-a")
        await self.service.run(task, self.parameters)
        self.assertFalse(self.engine.started.is_set())
        self.assertEqual(self.service.snapshot(1)["last_task"]["phase"], "cancelled")
        self.assertEqual(self.repository.images, ["old-result"])

    async def test_cancel_running_task_waits_for_cleanup(self):
        self.engine.release = asyncio.Event()
        task = self.reserve()
        running = asyncio.create_task(self.service.run(task, self.parameters))
        await self.engine.started.wait()
        self.assertTrue(await self.service.stop(1, "task-a"))
        await running
        self.engine.interrupt.assert_awaited_once()
        self.assertTrue(task.finished.is_set())
        self.assertEqual(self.service.snapshot(1)["last_task"]["phase"], "cancelled")

    async def test_repeated_stop_does_not_interrupt_cleanup_twice(self):
        self.engine.release = asyncio.Event()
        interrupt_started = asyncio.Event()
        interrupt_release = asyncio.Event()

        async def interrupt(*args):
            interrupt_started.set()
            await interrupt_release.wait()

        self.engine.interrupt.side_effect = interrupt
        task = self.reserve()
        running = asyncio.create_task(self.service.run(task, self.parameters))
        await self.engine.started.wait()
        first_stop = asyncio.create_task(self.service.stop(1))
        await interrupt_started.wait()
        second_stop = asyncio.create_task(self.service.stop(1))
        interrupt_release.set()
        await asyncio.gather(first_stop, second_stop, running)
        self.engine.interrupt.assert_awaited_once()

    async def test_database_failure_does_not_replace_previous_result(self):
        self.repository.status = "failed"
        with self.assertLogs("server.generation.coordinator", level="ERROR"):
            await self.service.run(self.reserve(), self.parameters)
        self.assertEqual(self.repository.images, ["old-result"])
        self.assertEqual(self.repository.discarded, ["new-result"])
        self.assertEqual(self.service.snapshot(1)["last_task"]["status"], "error")

    async def test_stop_during_commit_is_rejected_and_commit_completes(self):
        self.repository.final_started = threading.Event()
        self.repository.final_release = threading.Event()
        task = self.reserve()
        running = asyncio.create_task(self.service.run(task, self.parameters))
        try:
            self.assertTrue(await asyncio.to_thread(self.repository.final_started.wait, 2))
            with self.assertRaises(TaskConflictError):
                await self.service.stop(1)
        finally:
            self.repository.final_release.set()
            await running
        self.assertEqual(self.repository.images, ["new-result"])
        self.assertEqual(self.service.snapshot(1)["last_task"]["status"], "completed")

    async def test_transport_cancellation_during_commit_preserves_committed_files(self):
        self.repository.final_started = threading.Event()
        self.repository.final_release = threading.Event()
        task = self.reserve()
        running = asyncio.create_task(self.service.run(task, self.parameters))
        try:
            self.assertTrue(await asyncio.to_thread(self.repository.final_started.wait, 2))
            running.cancel()
            await asyncio.sleep(0)
        finally:
            self.repository.final_release.set()
            await running
        self.assertEqual(self.repository.images, ["new-result"])
        self.assertEqual(self.repository.discarded, [])
        self.assertEqual(self.service.snapshot(1)["last_task"]["status"], "completed")

    async def test_validation_failure_never_reserves_slot(self):
        with self.assertRaises(ValueError):
            self.service.reserve(TaskContext(1, "bad", "missing"), GenerationParameters("x", workflow="missing"))
        self.assertIsNone(self.service.tasks.active)


class FakeConnection:
    def __init__(self, on_send=None):
        self.messages = []
        self.on_send = on_send

    async def accept(self):
        pass

    async def send_text(self, data):
        self.messages.append(json.loads(data))
        if self.on_send:
            self.on_send()


class EventRoutingTests(unittest.IsolatedAsyncioTestCase):
    async def test_task_events_only_reach_authenticated_owner(self):
        manager = ConnectionManager()
        own = FakeConnection()
        other = FakeConnection()
        await manager.connect(own, user_id=1)
        await manager.connect(other, user_id=2)
        event = StateEvent("media_generated", {"image": "private.png"}, 1, context())
        await manager.publish(event)
        self.assertEqual(own.messages[0]["task_id"], "task-a")
        self.assertEqual(other.messages, [])

    async def test_disconnect_during_delivery_does_not_mutate_iteration(self):
        manager = ConnectionManager()
        first = FakeConnection()
        second = FakeConnection()
        first.on_send = lambda: manager.disconnect(first)
        await manager.connect(first, user_id=1)
        await manager.connect(second, user_id=1)
        await manager.publish(StateEvent("is_generating", False, 1, context()))
        self.assertEqual(len(second.messages), 1)

    async def test_only_explicit_public_fields_can_broadcast(self):
        with self.assertRaises(ValueError):
            StateEvent("media_generated", "private", None)
        with self.assertRaises(ValueError):
            StateEvent("error", "private", 2, context())
        manager = ConnectionManager()
        connections = [FakeConnection(), FakeConnection()]
        for user, connection in enumerate(connections):
            await manager.connect(connection, user_id=user)
        await manager.publish(StateEvent("is_service_available", True, None))
        self.assertTrue(all(len(connection.messages) == 1 for connection in connections))

    async def test_event_keeps_identity_after_task_slot_is_reused(self):
        publisher = EventPublisher()
        delivered = []
        publisher.subscribe(delivered.append)
        manager = TaskManager()
        original = manager.reserve(context())
        value = {"images": ["private"]}
        publisher.task(original.context, "preview_update", value)
        manager.finish(original, "completed")
        manager.reserve(context(2, "other-task"))
        value["images"].clear()
        self.assertEqual(delivered[0].payload()["task_id"], "task-a")
        self.assertEqual(delivered[0].value["images"], ["private"])


if __name__ == "__main__":
    unittest.main()
