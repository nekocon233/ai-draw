import base64
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

from PIL import Image
from comfy_api_simplified import ComfyWorkflowWrapper

from comfyui.requests.local_comfyui_request import LocalComfyUIRequest
from comfyui.structures.qwen_image_21 import parse_qwen_loras, qwen_options, validate_qwen_size
from server.generation.contracts import GenerationParameters, MediaOutput, ProviderInput
from server.generation.qwen_image_21 import QwenImage21Provider, validate_qwen_image_21


ROOT = Path(__file__).resolve().parents[1]


def image_bytes():
    buffer = BytesIO()
    Image.new("RGBA", (64, 32), (255, 0, 0, 128)).save(buffer, "PNG")
    return buffer.getvalue()


class QwenParameterTests(unittest.TestCase):
    def test_rejects_bad_sizes_and_expensive_pixel_budgets(self):
        for width, height in ((255, 1024), (513, 512), (3072, 3072), (True, 1024)):
            with self.subTest(size=(width, height)), self.assertRaises(ValueError):
                validate_qwen_size(width, height)
        self.assertEqual(validate_qwen_size(None, None), (1024, 1024))
        self.assertEqual(validate_qwen_size(2752, 1536), (2752, 1536))

    def test_exact_lora_tags_and_bounds(self):
        self.assertEqual(parse_qwen_loras(""), [])
        self.assertEqual(parse_qwen_loras("<lora:folder/style:0.8>\n<lora:style2.safetensors:0>"),
                         [("folder/style.safetensors", 0.8), ("style2.safetensors", 0.0)])
        for value in ("hello <lora:style:0.8>", "<lora:style:nan>", "<lora:style:1.1>", "<lora:style:-0.1>"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_qwen_loras(value)

    def test_options_reject_fractional_boolean_and_unsupported_values(self):
        self.assertEqual(qwen_options(None), (40, 1024))
        # Records saved while the retired seed and reference-mode options existed still carry them.
        self.assertEqual(qwen_options({"qwen_seed": "7", "qwen_reference_mode": "reference"}), (40, 1024))
        for options in ({"qwen_steps": 25.5}, {"qwen_steps": True}, {"qwen_reference_resolution": "9999"}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                qwen_options(options)

    def test_cross_model_loras_fail_before_dispatch(self):
        cfg = SimpleNamespace(workflow_defaults=SimpleNamespace(workflow_metadata={
            "qwen_image_21_t2i": {"lora_models": [{"name": "style.safetensors"}]},
        }))
        with patch("server.generation.qwen_image_21.get_config", return_value=cfg):
            validate_qwen_image_21(GenerationParameters("x", workflow="qwen_image_21_t2i", lora_prompt="<lora:style:0.5>"))
            with self.assertRaisesRegex(ValueError, "未登记"):
                validate_qwen_image_21(GenerationParameters("x", workflow="qwen_image_21_t2i", lora_prompt="<lora:AmeniwaZ:0.8>"))
            with self.assertRaisesRegex(ValueError, "图生图"):
                validate_qwen_image_21(GenerationParameters("x", workflow="qwen_image_21_t2i", reference_image_2="image"))

    def test_source_snapshot_preserves_dimensions_and_false(self):
        updates = GenerationParameters("x", width=768, height=1024, use_original_size=False).source_updates()
        self.assertEqual((updates["width"], updates["height"], updates["use_original_size"]), (768, 1024, False))


class QwenWorkflowTests(unittest.IsolatedAsyncioTestCase):
    def test_templates_include_lora_in_the_sampling_model_path(self):
        for editing in (False, True):
            with self.subTest(editing=editing):
                graph = ComfyWorkflowWrapper(ROOT / f"configs/workflows/qwen_image_21_{'i2i' if editing else 't2i'}_workflow_api.json")
                model_path = []
                node_id = graph["6"]["inputs"]["model"][0]
                while True:
                    node = graph[node_id]
                    model_path.append(node["class_type"])
                    if "model" not in node["inputs"]:
                        break
                    self.assertLess(len(model_path), len(graph), "model path must not contain cycles")
                    node_id = node["inputs"]["model"][0]
                expected = ["LoraLoaderModelOnly", "UNETLoader"]
                if editing:
                    expected.insert(0, "QwenImage21Cache")
                self.assertEqual(model_path, expected)
                self.assertEqual(graph["100"]["inputs"]["lora_name"], "Ameniwa.safetensors")
                self.assertEqual(graph["100"]["inputs"]["strength_model"], 0.8)

    def request(self):
        request = LocalComfyUIRequest.__new__(LocalComfyUIRequest)
        request._queue_and_poll = AsyncMock(return_value="prompt-id")
        request._upload_overwrite_image = AsyncMock(return_value={"name": "reference.png", "subfolder": "ai_draw"})
        request.api = SimpleNamespace(
            get_history=Mock(return_value={"prompt-id": {"outputs": {"8": {"images": [
                {"filename": "result.png", "subfolder": "", "type": "output"}
            ]}}}}), get_image=Mock(return_value=image_bytes()),
        )
        return request

    async def run_graph(self, editing=False, images=None, loras=None, original=True):
        graph = ComfyWorkflowWrapper(ROOT / f"configs/workflows/qwen_image_21_{'i2i' if editing else 't2i'}_workflow_api.json")
        request = self.request()
        cfg = SimpleNamespace(qwen_image_21=SimpleNamespace(model="model", text_encoder="clip", vae="vae"))
        with patch("utils.config_loader.get_config", return_value=cfg):
            result = await request.generate_qwen_image_21(
                graph, "test prompt", images or [], loras or [], 123, 768, 1024, original, 25, 768,
            )
        self.assertEqual(base64.b64decode(result.data), image_bytes())
        self.assertEqual(graph["1"]["inputs"]["unet_name"], "model")
        self.assertEqual(graph["4"]["inputs"]["prompt"], "test prompt")
        self.assertEqual(graph["6"]["inputs"]["steps"], 25)
        self.assertEqual(graph["6"]["inputs"]["seed"], 123)
        for call in request._upload_overwrite_image.call_args_list:
            self.assertFalse(Path(call.args[0]).exists(), "temporary references must be cleaned")
        return graph, request

    async def test_text_generation_uses_requested_size_without_reference_nodes(self):
        graph, request = await self.run_graph()
        request._upload_overwrite_image.assert_not_awaited()
        self.assertEqual(graph["6"]["inputs"]["latent_image"], ["5", 0])
        self.assertEqual(graph["5"]["inputs"]["width"], 768)
        self.assertFalse(any(node["class_type"] == "LoadImage" for node in graph.values()))
        self.assertFalse(any(node["class_type"] == "LoraLoaderModelOnly" for node in graph.values()))
        self.assertEqual(graph["6"]["inputs"]["model"], ["1", 0])

    async def test_selected_lora_replaces_the_template_default_once(self):
        raw = base64.b64encode(image_bytes()).decode()
        for editing in (False, True):
            with self.subTest(editing=editing):
                graph, _ = await self.run_graph(editing, [raw] if editing else [], [("other.safetensors", 0.35)])
                loaders = [node for node in graph.values() if node["class_type"] == "LoraLoaderModelOnly"]
                self.assertEqual(len(loaders), 1)
                self.assertEqual(loaders[0]["inputs"], {
                    "model": ["1", 0], "lora_name": "other.safetensors", "strength_model": 0.35,
                })
                self.assertEqual(graph["9" if editing else "6"]["inputs"]["model"], ["100", 0])

    async def test_edit_inputs_and_loras_are_bound_without_stale_optional_nodes(self):
        raw = base64.b64encode(image_bytes()).decode()
        graph, request = await self.run_graph(True, [raw, raw, raw], [("folder/style.safetensors", 0.8), ("other.safetensors", 0.5)])
        self.assertEqual(request._upload_overwrite_image.await_count, 3)
        self.assertEqual(graph["4"]["inputs"]["images.image_3"], ["23", 0])
        self.assertEqual(graph["4"]["inputs"]["vae"], ["3", 0])
        self.assertEqual(graph["6"]["inputs"]["latent_image"], ["4", 2])
        self.assertEqual(graph["100"]["inputs"]["model"], ["1", 0])
        self.assertEqual(graph["101"]["inputs"]["model"], ["100", 0])
        self.assertEqual(graph["9"]["inputs"]["model"], ["101", 0])
        self.assertEqual(graph["100"]["inputs"]["lora_name"], "folder/style.safetensors")
        self.assertEqual(sum(node["class_type"] == "LoraLoaderModelOnly" for node in graph.values()), 2)
        next_graph, _ = await self.run_graph(True, [raw], original=False)
        self.assertEqual(next_graph["6"]["inputs"]["latent_image"], ["5", 0])
        self.assertNotIn("images.image_2", next_graph["4"]["inputs"])
        self.assertNotIn("100", next_graph)
        self.assertFalse(any(node["class_type"] == "LoraLoaderModelOnly" for node in next_graph.values()))
        self.assertEqual(next_graph["9"]["inputs"]["model"], ["1", 0])

    async def test_missing_lora_never_starts_comfy_generation(self):
        comfy = SimpleNamespace(get_object_info=AsyncMock(return_value={"input": {"required": {"lora_name": [[]]}}}),
                                generate_qwen_image_21=AsyncMock())
        request = ProviderInput(GenerationParameters("x", lora_prompt="<lora:missing:0.8>"), (None, None, None))
        with self.assertRaisesRegex(ValueError, "未安装"):
            await QwenImage21Provider(comfy).generate(request)
        comfy.generate_qwen_image_21.assert_not_awaited()
