import asyncio
import base64
import tempfile
import threading
import unittest
from dataclasses import replace
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import yaml
from PIL import Image, ImageDraw

from server.generation.contracts import GenerationParameters, MediaOutput, ProviderInput, TaskContext
from server.generation.engine import GenerationEngine
from server.generation.providers import CallbackProvider, ProviderRegistry, build_provider_registry
from server.generation.storage import ArtifactStorage
from server.generation.workflows import WorkflowCatalog


def png_base64(size=(3, 2)):
    buffer = BytesIO()
    Image.new("RGBA", size, (12, 34, 56, 100)).save(buffer, "PNG")
    return base64.b64encode(buffer.getvalue()).decode()


class ProviderPipelineTests(unittest.IsolatedAsyncioTestCase):
    async def test_callback_adapter_preserves_input_and_requires_a_result(self):
        async def complete(finish_callback, prompt_text):
            self.assertEqual(prompt_text, "prompt")
            finish_callback("image-bytes")

        provider = CallbackProvider(complete, lambda request: {"prompt_text": request.parameters.prompt}, "image")
        request = ProviderInput(GenerationParameters("prompt"), (None, None, None))
        self.assertEqual(await provider.generate(request), MediaOutput("image-bytes", "image"))
        provider = CallbackProvider(AsyncMock(), lambda request: {}, "image")
        with self.assertRaisesRegex(RuntimeError, "未收到"):
            await provider.generate(request)

    async def test_all_configured_workflows_resolve_and_keep_native_options(self):
        methods = {
            name: AsyncMock(side_effect=lambda finish_callback, **kwargs: finish_callback("content"))
            for name in ("generate_minimax_h3",)
        }
        comfyui = SimpleNamespace(**methods, interrupt=AsyncMock(), switch_workflow=Mock())
        registry = build_provider_registry(comfyui)
        root = Path(__file__).resolve().parents[1]
        metadata = yaml.safe_load((root / "configs/app_config.yaml").read_text())["workflow_defaults"]["workflow_metadata"]
        catalog = WorkflowCatalog(metadata, registry)
        self.assertEqual(len(catalog.list()), len(metadata))
        for retired in ("t2i", "i2i", "ideogram_t2i", "ideogram_style", "flf2v", "i2v"):
            with self.subTest(workflow=retired), self.assertRaisesRegex(ValueError, "未知工作流"):
                catalog.validate(GenerationParameters("x", workflow=retired))
        self.assertTrue(all(item["max_count"] == 1 for item in catalog.list() if item["output_type"] == "video"))
        for workflow in ("qwen_image_21_t2i", "qwen_image_21_i2i"):
            self.assertEqual(catalog.describe(workflow)["lora_labels"],
                             {"Ameniwa": "Ameniwa", "Sen": "Sen", "Daikei": "Daikei", "CZN": "CZN"})
        self.assertEqual(catalog.describe("gpt_image")["lora_labels"], {})
        params = GenerationParameters("audio and video", workflow="minimax_h3", workflow_options={"h3_duration": "10"})
        await registry.get("comfyui_minimax_h3").provider.generate(ProviderInput(params, ("start", None, None), "end"))
        options = comfyui.generate_minimax_h3.call_args.kwargs
        self.assertEqual(options["duration"], 10)
        self.assertEqual(options["aspect_ratio"], "auto")
        self.assertEqual(options["start_image_base64"], "start")
        self.assertFalse(options["audio"])
        params = GenerationParameters("audio and video", workflow="minimax_h3", workflow_options={"h3_audio": "native"})
        catalog.validate(params)
        await registry.get("comfyui_minimax_h3").provider.generate(ProviderInput(params, (None, None, None)))
        self.assertTrue(comfyui.generate_minimax_h3.call_args.kwargs["audio"])
        for workflow in ("minimax_h3", "minimax_h3_ref"):
            audio = next(item for item in metadata[workflow]["parameters"] if item["name"] == "h3_audio")
            self.assertEqual((audio["default"], audio["options"]), ("silent", ["silent", "native"]))
        with self.assertRaisesRegex(ValueError, "声音"):
            catalog.validate(GenerationParameters("x", workflow="minimax_h3", workflow_options={"h3_audio": "loud"}))
        with self.assertRaises(ValueError):
            catalog.validate(GenerationParameters("x", workflow="minimax_h3", count=2))
        with self.assertRaises(ValueError):
            catalog.validate(GenerationParameters("x", workflow="minimax_h3", workflow_options={"unknown": 1}))
        with self.assertRaises(ValueError):
            catalog.validate(GenerationParameters("x", workflow="missing"))
        for retired_provider in ("comfyui_flf2v", "comfyui_i2v"):
            with self.assertRaisesRegex(ValueError, "未注册"):
                registry.get(retired_provider)

    async def test_new_provider_uses_shared_pipeline_without_service_changes(self):
        provider = SimpleNamespace(generate=AsyncMock(return_value=MediaOutput(png_base64(), "image")))
        registry = ProviderRegistry()
        registry.register("custom", provider)
        catalog = WorkflowCatalog({
            "new-workflow": {
                "provider": "custom", "output_type": "image", "supports_original_size": True,
                "parameters": [{"name": "count", "max": 2}],
            },
        }, registry)
        params = GenerationParameters("prompt", workflow="new-workflow", count=2, reference_image=png_base64((5, 4)))
        with tempfile.TemporaryDirectory() as directory:
            engine = GenerationEngine(catalog, ArtifactStorage(directory))
            engine.validate(params)
            events = []
            urls = await engine.generate(params, TaskContext(7, "task", "new-workflow"), lambda *args: events.append(args), lambda: None)
            self.assertEqual(len(urls), 2)
            self.assertEqual(len(events), 2)
            self.assertEqual(provider.generate.await_count, 2)
            for url in urls:
                self.assertTrue(url.startswith("/uploads/generated/7/"))
                with Image.open(Path(directory) / url.removeprefix("/uploads/")) as image:
                    self.assertEqual(image.size, (5, 4))

    async def test_preset_precedes_the_description_for_providers_but_stays_separate_in_history(self):
        provider = SimpleNamespace(generate=AsyncMock(return_value=MediaOutput(png_base64(), "image")))
        registry = ProviderRegistry()
        registry.register("custom", provider)
        catalog = WorkflowCatalog({"edit": {"provider": "custom", "supports_multi_image": True}}, registry)
        preset = {"id": "sketch_finish", "title": "草稿成品化", "description": "", "prompt": "@图片1 是线稿草稿。"}
        params = GenerationParameters("红色连衣裙", workflow="edit", reference_image=png_base64(), prompt_preset=preset)
        with tempfile.TemporaryDirectory() as directory:
            engine = GenerationEngine(catalog, ArtifactStorage(directory))
            engine.validate(params)
            await engine.generate(params, TaskContext(7, "task", "edit"), Mock(), lambda: None)
            sent = provider.generate.await_args.args[0].parameters
            self.assertEqual((sent.prompt, sent.prompt_preset), ("@图片1 是线稿草稿。红色连衣裙", None))
            self.assertEqual(replace(params, prompt="").for_provider().prompt, "@图片1 是线稿草稿。")
            updates = params.source_updates()
            self.assertEqual((updates["content"], updates["prompt_preset"]), ("红色连衣裙", preset))
            # References named by the preset are validated like the user's own mentions.
            with self.assertRaisesRegex(ValueError, "图片1不存在"):
                engine.validate(replace(params, reference_image=None))

    async def test_provider_output_type_mismatch_never_writes_a_file(self):
        registry = ProviderRegistry()
        registry.register("wrong", SimpleNamespace(generate=AsyncMock(return_value=MediaOutput(b"video", "video"))))
        catalog = WorkflowCatalog({"test": {"provider": "wrong"}}, registry)
        storage = SimpleNamespace(upload_dir="/unused", save=AsyncMock())
        engine = GenerationEngine(catalog, storage)
        with self.assertRaisesRegex(RuntimeError, "无效"):
            await engine.generate(GenerationParameters("x", workflow="test"), TaskContext(1, "a", "test"), Mock(), lambda: None)
        storage.save.assert_not_awaited()

    async def test_qwen_edit_output_keeps_all_edges_at_original_and_custom_sizes(self):
        root = Path(__file__).resolve().parents[1]
        metadata = yaml.safe_load((root / "configs/app_config.yaml").read_text())["workflow_defaults"]["workflow_metadata"]
        colors = ("red", "green", "blue", "yellow")
        for source_size, target in (((80, 160), (120, 80)), ((160, 80), (80, 120))):
            for original in (True, False):
                with self.subTest(source_size=source_size, original=original), tempfile.TemporaryDirectory() as directory:
                    source = Image.new("RGB", source_size, "black")
                    draw = ImageDraw.Draw(source)
                    w, h = source_size
                    for box, color in zip(((0, 0, 19, 19), (w-20, 0, w-1, 19),
                                           (0, h-20, 19, h-1), (w-20, h-20, w-1, h-1)), colors):
                        draw.rectangle(box, fill=color)
                    buffer = BytesIO()
                    source.save(buffer, "PNG")
                    provider = SimpleNamespace(generate=AsyncMock(return_value=MediaOutput(buffer.getvalue(), "image")))
                    registry = ProviderRegistry()
                    registry.register("comfyui_qwen_image_21", provider)
                    engine = GenerationEngine(WorkflowCatalog({"qwen_image_21_i2i": metadata["qwen_image_21_i2i"]}, registry), ArtifactStorage(directory))
                    params = GenerationParameters("prompt", workflow="qwen_image_21_i2i", reference_image=png_base64(target if original else (91, 63)),
                                                  use_original_size=original, width=target[0], height=target[1])
                    urls = await engine.generate(params, TaskContext(7, "task", "qwen_image_21_i2i"), Mock(), lambda: None)
                    with Image.open(Path(directory) / urls[0].removeprefix("/uploads/")) as image:
                        self.assertEqual(image.size, target)
                        # The mismatched canvas must keep every corner of the provider image.
                        pixels = {color for _, color in image.getcolors(maxcolors=target[0] * target[1])}
                        for color in colors:
                            self.assertIn(Image.new("RGB", (1, 1), color).getpixel((0, 0)), pixels)
                        self.assertEqual(image.getpixel((0, 0)), (255, 255, 255))

    async def test_contained_output_preserves_transparency(self):
        with tempfile.TemporaryDirectory() as directory:
            url = await ArtifactStorage(directory).save(MediaOutput(png_base64((40, 80)), "image"), 7,
                                                         (120, 80), resize_mode="contain")
            with Image.open(Path(directory) / url.removeprefix("/uploads/")) as image:
                self.assertEqual(image.size, (120, 80))
                self.assertEqual(image.mode, "RGBA")
                self.assertEqual(image.getpixel((0, 0))[3], 0)
                self.assertEqual(image.getpixel((60, 40)), (12, 34, 56, 100))

    async def test_default_resize_still_fills_the_canvas(self):
        with tempfile.TemporaryDirectory() as directory:
            url = await ArtifactStorage(directory).save(MediaOutput(png_base64((40, 80)), "image"), 7, (120, 80))
            with Image.open(Path(directory) / url.removeprefix("/uploads/")) as image:
                self.assertEqual(image.size, (120, 80))
                self.assertEqual(image.getpixel((0, 0)), (12, 34, 56))

    async def test_video_storage_uses_configured_root_and_preserves_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = ArtifactStorage(directory)
            content = b"native-video-with-audio"
            url = await storage.save(MediaOutput(base64.b64encode(content).decode(), "video"), 9, None)
            self.assertTrue(url.startswith("/uploads/video/9/"))
            self.assertEqual((Path(directory) / url.removeprefix("/uploads/")).read_bytes(), content)

    async def test_cancelled_write_waits_for_writer_and_removes_partial_output(self):
        started, release = threading.Event(), threading.Event()
        write_bytes = Path.write_bytes

        def delayed_write(path, content):
            started.set()
            if not release.wait(3):
                raise RuntimeError("Test write was not released")
            return write_bytes(path, content)

        with tempfile.TemporaryDirectory() as directory, patch.object(Path, "write_bytes", delayed_write):
            writing = asyncio.create_task(ArtifactStorage(directory).save(MediaOutput(b"video", "video"), 1, None))
            try:
                self.assertTrue(await asyncio.to_thread(started.wait, 2))
                writing.cancel()
                await asyncio.sleep(0)
            finally:
                release.set()
            with self.assertRaises(asyncio.CancelledError):
                await writing
            self.assertEqual(list(Path(directory).rglob("*.mp4")), [])


if __name__ == "__main__":
    unittest.main()
