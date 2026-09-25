import asyncio
import threading
import unittest
from types import SimpleNamespace

from server.ai_draw_service import AIDrawService
from server.generation.events import EventPublisher


class PromptIsolationTests(unittest.IsolatedAsyncioTestCase):
    async def test_prompt_activity_is_private_and_counts_overlapping_requests(self):
        started = {name: threading.Event() for name in ("first", "second")}
        release = {name: threading.Event() for name in started}

        def generate(description, template, preset=""):
            started[description].set()
            if not release[description].wait(3):
                raise RuntimeError("Test prompt was not released")
            return description

        service = AIDrawService.__new__(AIDrawService)
        service._prompt_tasks = {}
        service.ai_prompt = SimpleNamespace(generate=generate)
        service.events = EventPublisher()
        service.is_service_available = True
        service.generation = SimpleNamespace(snapshot=lambda user_id: {"is_generating": False, "last_task": None})
        events = []
        service.events.subscribe(events.append)
        tasks = {
            name: asyncio.create_task(service.generate_prompt(name, user_id=1))
            for name in started
        }
        try:
            for signal in started.values():
                self.assertTrue(await asyncio.to_thread(signal.wait, 2))
            self.assertTrue(service.initial_state(1)["is_generating_prompt"])
            self.assertFalse(service.initial_state(2)["is_generating_prompt"])
            release["first"].set()
            await tasks["first"]
            self.assertTrue(service.initial_state(1)["is_generating_prompt"])
        finally:
            for signal in release.values():
                signal.set()
            await asyncio.gather(*tasks.values())
        self.assertFalse(service.initial_state(1)["is_generating_prompt"])
        self.assertTrue(all(event.user_id == 1 and event.context is None for event in events))
        activity = [event.value for event in events if event.field == "is_generating_prompt"]
        self.assertEqual(activity, [True, True, True, False])


if __name__ == "__main__":
    unittest.main()
