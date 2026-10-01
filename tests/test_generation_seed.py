import asyncio
import base64
import tempfile
import unittest
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from comfyui.structures.minimax_h3 import validate_minimax_h3_options
from comfyui.structures.seed import (
    H3_SEED_OPTION, MAX_SEED, QWEN_SEED_OPTION, RANDOM_SEED_LIMIT, fixed_seed, round_seeds,
)
from server.database import Base
from server.generation.contracts import GenerationParameters, MediaOutput, ProviderInput, TaskContext
from server.generation.coordinator import GenerationCoordinator
from server.generation.engine import GenerationEngine
from server.generation.events import EventPublisher
from server.generation.minimax_h3_ref import MiniMaxH3ReferenceProvider
from server.generation.persistence import SQLAlchemyGenerationRepository
from server.generation.providers import ProviderRegistry, build_provider_registry
from server.generation.qwen_image_21 import QwenImage21Provider, validate_qwen_image_21
from server.generation.storage import ArtifactStorage
from server.generation.workflows import WorkflowCatalog
from server.models import ChatMessage, ChatSession, GeneratedImage, User


def png_base64():
    buffer = BytesIO()
    Image.new("RGB", (4, 4), (1, 2, 3)).save(buffer, "PNG")
    return base64.b64encode(buffer.getvalue()).decode()


class SeedOptionTests(unittest.TestCase):
    def test_empty_means_random_and_integers_or_digit_strings_are_fixed(self):
        for value in (None, ""):
            self.assertIsNone(fixed_seed({"k": value}, "k"))
        self.assertIsNone(fixed_seed(None, "k"))
        self.assertEqual(fixed_seed({"k": 123}, "k"), 123)
        self.assertEqual(fixed_seed({"k": " 42 "}, "k"), 42)
        self.assertEqual(fixed_seed({"k": MAX_SEED}, "k"), MAX_SEED)
        for value in (True, -1, 1.5, "1e3", "-3", "x", "１２"):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "种子"):
                fixed_seed({"k": value}, "k")

    def test_a_batch_must_keep_every_image_seed_in_range(self):
        self.assertEqual(fixed_seed({"k": MAX_SEED - 3}, "k", count=4), MAX_SEED - 3)
        with self.assertRaisesRegex(ValueError, str(MAX_SEED - 3)):
            fixed_seed({"k": MAX_SEED - 2}, "k", count=4)

    def test_fixed_seeds_count_up_and_random_seeds_are_drawn_per_result(self):
        self.assertEqual(round_seeds({"k": 7}, "k", 3), [7, 8, 9])
        for _ in range(20):
            seeds = round_seeds({}, "k", 4)
            self.assertEqual(len(set(seeds)), 4)
            self.assertTrue(all(0 <= seed < RANDOM_SEED_LIMIT for seed in seeds))
        with patch("comfyui.structures.seed.random.sample", return_value=[900, 5]) as sample:
            self.assertEqual(round_seeds({"k": ""}, "k", 2), [900, 5])
        sample.assert_called_once_with(range(RANDOM_SEED_LIMIT), 2)

    def test_workflow_validators_accept_and_check_their_own_seed_option(self):
        valid = GenerationParameters("p", count=2, workflow_options={QWEN_SEED_OPTION: 5})
        validate_qwen_image_21(valid)
        with self.assertRaisesRegex(ValueError, "种子"):
            validate_qwen_image_21(GenerationParameters("p", count=2, workflow_options={QWEN_SEED_OPTION: MAX_SEED}))
        self.assertEqual(validate_minimax_h3_options({H3_SEED_OPTION: "9", "h3_duration": "5"}), (5.0, "auto", False))
        validate_minimax_h3_options({H3_SEED_OPTION: ""})
        with self.assertRaisesRegex(ValueError, "种子"):
            validate_minimax_h3_options({H3_SEED_OPTION: "abc"})


class SeedPipelineTests(unittest.IsolatedAsyncioTestCase):
    async def run_engine(self, *, seed_option, options, count):
        seen = []

        async def generate(request):
            seen.append(request.seed)
            return MediaOutput(png_base64(), "image")

        registry = ProviderRegistry()
        registry.register("custom", SimpleNamespace(generate=generate), seed_option=seed_option)
        catalog = WorkflowCatalog({
            "demo": {"provider": "custom", "output_type": "image", "parameters": [{"name": "count", "max": 4}]},
        }, registry)
        params = GenerationParameters("prompt", workflow="demo", count=count, workflow_options=options)
        artifacts = []
        with tempfile.TemporaryDirectory() as directory:
            engine = GenerationEngine(catalog, ArtifactStorage(directory))
            await engine.generate(params, TaskContext(7, "task", "demo"), lambda *args: artifacts.append(args), lambda: None)
        return seen, [args[3] for args in artifacts]

    async def test_fixed_seed_increments_per_image_and_is_reported_with_each_artifact(self):
        seen, reported = await self.run_engine(seed_option="demo_seed", options={"demo_seed": 100}, count=3)
        self.assertEqual(seen, [100, 101, 102])
        self.assertEqual(reported, [100, 101, 102])

    async def test_random_mode_draws_an_independent_seed_for_each_image(self):
        with patch("comfyui.structures.seed.random.sample", return_value=[900, 5]):
            seen, reported = await self.run_engine(seed_option="demo_seed", options={}, count=2)
        self.assertEqual(seen, [900, 5])
        self.assertEqual(reported, [900, 5])

    async def test_workflows_without_a_seed_option_get_and_record_no_seed(self):
        seen, reported = await self.run_engine(seed_option=None, options={"demo_seed": 100}, count=2)
        self.assertEqual(seen, [None, None])
        self.assertEqual(reported, [None, None])

    async def test_providers_pass_the_engine_seed_to_comfyui(self):
        def finishing(content):
            async def call(finish_callback, **kwargs):
                finish_callback(content)
            return AsyncMock(side_effect=call)

        comfyui = SimpleNamespace(
            generate_qwen_image_21=finishing("image"), generate_minimax_h3=finishing("video"),
            generate_minimax_h3_ref=finishing("video"), interrupt=AsyncMock(), switch_workflow=Mock(),
        )
        qwen = ProviderInput(GenerationParameters("p"), (None, None, None), seed=11)
        await QwenImage21Provider(comfyui).generate(qwen)
        self.assertEqual(comfyui.generate_qwen_image_21.await_args.kwargs["seed"], 11)
        # The verification script's constructor seed still applies when the engine sets none.
        await QwenImage21Provider(comfyui, seed=42).generate(ProviderInput(GenerationParameters("p"), (None, None, None)))
        self.assertEqual(comfyui.generate_qwen_image_21.await_args.kwargs["seed"], 42)

        registry = build_provider_registry(comfyui)
        self.assertEqual(registry.get("comfyui_qwen_image_21").seed_option, QWEN_SEED_OPTION)
        self.assertEqual(registry.get("comfyui_minimax_h3").seed_option, H3_SEED_OPTION)
        self.assertEqual(registry.get("comfyui_minimax_h3_ref").seed_option, H3_SEED_OPTION)
        self.assertIsNone(registry.get("openai_image").seed_option)
        h3 = ProviderInput(GenerationParameters("p", workflow="minimax_h3"), (None, None, None), seed=12)
        await registry.get("comfyui_minimax_h3").provider.generate(h3)
        self.assertEqual(comfyui.generate_minimax_h3.await_args.kwargs["seed"], 12)
        reference = ProviderInput(
            GenerationParameters("p", workflow="minimax_h3_ref", reference_image="subject", motion_reference_images=("pose",)),
            ("subject", None, None), motion_images=("pose",), seed=13,
        )
        await MiniMaxH3ReferenceProvider(comfyui).generate(reference)
        self.assertEqual(comfyui.generate_minimax_h3_ref.await_args.kwargs["seed"], 13)


class SeedEngine:
    def validate(self, parameters):
        pass

    async def generate(self, parameters, context, on_artifact, check_cancelled):
        on_artifact("/uploads/generated/1/a.png", 0, 2, 500)
        on_artifact("/uploads/generated/1/b.png", 1, 2, 501)
        return ["/uploads/generated/1/a.png", "/uploads/generated/1/b.png"]

    async def interrupt(self, workflow, runner):
        pass


class SeedPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.sessions() as db:
            db.add(User(id=1, username="owner", password_hash="test"))
            db.add(ChatSession(user_id=1, session_id="session-a", title="Session"))
            db.flush()
            db.add(ChatMessage(user_id=1, session_id="session-a", message_id="message-a", type="user", content="prompt"))
            db.commit()
        self.addCleanup(self.engine.dispose)
        patcher = patch("server.database.SessionLocal", self.sessions)
        patcher.start()
        self.addCleanup(patcher.stop)
        storage = SimpleNamespace(delete_file=Mock(), save_generated_image=Mock(), get_file_url=lambda path: path)
        for target in ("utils.file_storage.get_file_storage", "utils.media_file_references.get_file_storage",
                       "server.api.user.get_file_storage"):
            mock = patch(target, return_value=storage)
            mock.start()
            self.addCleanup(mock.stop)

    def seeds(self):
        with self.sessions() as db:
            return [image.seed for image in db.query(GeneratedImage).order_by(GeneratedImage.image_index)]

    def test_round_seeds_reach_events_task_snapshot_database_and_round_payload(self):
        events = EventPublisher()
        published = []
        events.subscribe(lambda event: published.append(event))
        coordinator = GenerationCoordinator(SeedEngine(), SQLAlchemyGenerationRepository(), events)
        context = TaskContext(1, "task-a", "demo", "session-a", "message-a-reply")
        params = GenerationParameters("prompt", workflow="demo", count=2)
        task = coordinator.reserve(context, params)
        asyncio.run(coordinator.run(task, params))
        media = [event.value for event in published if event.field == "media_generated"]
        self.assertEqual([item["seed"] for item in media], [500, 501])
        previews = [event.value["data"]["seed"] for event in published if event.field == "preview_update"]
        self.assertEqual(previews, [500, 501])
        self.assertEqual(coordinator.tasks.last_task(1)["seeds"], [500, 501])
        self.assertEqual(self.seeds(), [500, 501])
        from server.api.session import _serialize_message
        with self.sessions() as db:
            reply = db.query(ChatMessage).filter_by(message_id="message-a-reply").one()
            payload = _serialize_message(reply)
        self.assertEqual(payload["images"], ["/uploads/generated/1/a.png", "/uploads/generated/1/b.png"])
        self.assertEqual(payload["seeds"], [500, 501])

    def test_chat_save_keeps_seeds_aligned_with_resent_images(self):
        from server.api.user import get_chat_history, save_chat_message
        repository = SQLAlchemyGenerationRepository()
        context = TaskContext(1, "task-a", "demo", "session-a", "message-a-reply")
        images = ["/uploads/generated/1/a.png", "/uploads/generated/1/b.png"]
        self.assertEqual(repository.persist(context, images, seeds=[500, 501]), "persisted")
        user = SimpleNamespace(id=1)
        message = {"message_id": "message-a-reply", "session_id": "session-a", "type": "assistant"}
        with self.sessions() as db:
            # Without seeds, rows whose image is unchanged keep their seed.
            save_chat_message({**message, "images": images}, current_user=user, db=db)
        self.assertEqual(self.seeds(), [500, 501])
        with self.sessions() as db:
            # Reordered images carry their own seeds; invalid values are dropped.
            save_chat_message({**message, "images": images[::-1], "seeds": [501, True]}, current_user=user, db=db)
        self.assertEqual(self.seeds(), [501, None])
        with self.sessions() as db:
            # Without seeds, an index whose image changed loses the old seed.
            save_chat_message({**message, "images": images}, current_user=user, db=db)
        self.assertEqual(self.seeds(), [None, None])
        with self.sessions() as db:
            history = get_chat_history(limit=50, offset=0, session_id="session-a", current_user=user, db=db)
        reply = next(item for item in history["messages"] if item.get("type") == "assistant")
        self.assertEqual(reply["seeds"], [None, None])


if __name__ == "__main__":
    unittest.main()
