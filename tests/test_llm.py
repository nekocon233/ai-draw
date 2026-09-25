import base64
import unittest
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from utils.image_mentions import validate_image_mentions
from utils.llm import LanguageModel, InvalidImageError, image_data_url


def png(color="red"):
    data = BytesIO()
    Image.new("RGB", (32, 32), color).save(data, "PNG")
    return base64.b64encode(data.getvalue()).decode("ascii")


def config():
    return SimpleNamespace(
        gpt_image=SimpleNamespace(api_key="proxy-key", base_url="http://proxy.invalid/v1", model="image-model"),
        codex_llm=SimpleNamespace(model="gpt-6-astra"),
    )


class LanguageModelTests(unittest.TestCase):
    def test_all_llm_callers_use_astra_and_the_proxy_connection(self):
        from utils.ai_prompt import AIPrompt
        from utils.session_title import SessionTitleGenerator
        with patch("utils.llm.get_config", return_value=config()), patch("utils.llm.OpenAI") as factory:
            for llm in (LanguageModel(), AIPrompt().llm, SessionTitleGenerator().llm):
                self.assertEqual(llm.model, "gpt-6-astra")
                self.assertEqual(llm.api_key, "proxy-key")
            self.assertEqual(factory.call_count, 3)
            factory.assert_called_with(api_key="proxy-key", base_url="http://proxy.invalid/v1", timeout=120.0)

    def test_text_only_requests_never_contain_images(self):
        with patch("utils.llm.get_config", return_value=config()), patch("utils.llm.OpenAI") as factory:
            factory.return_value.chat.completions.create.return_value.choices = [SimpleNamespace(message=SimpleNamespace(content="  answer  "))]
            llm = LanguageModel()
            self.assertEqual(llm.complete("original", system="instruction"), "answer")
            self.assertEqual(factory.return_value.chat.completions.create.call_args.kwargs["messages"], [
                {"role": "system", "content": "instruction"}, {"role": "user", "content": "original"},
            ])

    def test_vision_preserves_image_order_and_rejects_invalid_input_before_api_call(self):
        with patch("utils.llm.get_config", return_value=config()), patch("utils.llm.OpenAI") as factory:
            call = factory.return_value.chat.completions.create
            call.return_value.choices = [SimpleNamespace(message=SimpleNamespace(content="answer"))]
            llm = LanguageModel()
            red, blue = png("red"), png("blue")
            llm.complete("transition", images=[red, "data:image/png;base64," + blue])
            parts = call.call_args.kwargs["messages"][0]["content"]
            self.assertEqual([part["image_url"]["url"] for part in parts[1:]], ["data:image/png;base64," + red, "data:image/png;base64," + blue])
            call.reset_mock()
            with self.assertRaises(InvalidImageError):
                llm.complete("x", images=["https://example.invalid/image.png"])
            call.assert_not_called()

    def test_invalid_image_data_and_empty_model_output_fail_clearly(self):
        for value in ("", "not-base64", "data:text/plain;base64,eA==", "data:image/png;base64,eA=="):
            with self.subTest(value=value), self.assertRaises(InvalidImageError):
                image_data_url(value)
        with patch("utils.llm.get_config", return_value=config()), patch("utils.llm.OpenAI") as factory:
            factory.return_value.chat.completions.create.return_value.choices = []
            with self.assertRaisesRegex(ValueError, "未返回"):
                LanguageModel().complete("x")

class PromptAnalysisRouteTests(unittest.TestCase):
    def setUp(self):
        from server.api.prompt import router
        from server.auth import get_current_user
        self.user_dependency = get_current_user
        self.app = FastAPI()
        self.app.include_router(router, prefix="/api")
        self.app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)

    def test_image_analysis_uses_llm_and_remains_authenticated(self):
        with patch("server.api.prompt.describe_image", return_value="caption") as describe:
            response = self.client.post("/api/prompt/analyze-image", json={"image": "input", "description": "pose"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"prompt": "caption"})
            describe.assert_called_once_with("input", "pose")
            self.app.dependency_overrides.clear()
            self.assertEqual(self.client.post("/api/prompt/analyze-image", json={"image": "input", "description": "pose"}).status_code, 401)

    def test_presets_are_authenticated_and_leave_style_to_the_lora(self):
        response = self.client.get("/api/prompt/presets")
        self.assertEqual(response.status_code, 200)
        presets = response.json()["presets"]
        self.assertEqual(len({preset["id"] for preset in presets}), len(presets))
        for preset in presets:
            validate_image_mentions(preset["prompt"], ["a", "b", "c"])
            # Generation appends the user's description directly after the preset.
            self.assertTrue(preset["prompt"].endswith("。"), preset["id"])
        sketch = next(preset for preset in presets if preset["id"] == "sketch_finish")
        self.assertTrue(sketch["prompt"].startswith("@图片1 "))
        for term in ("二次元", "动漫", "插画", "画风", "风格", "平涂", "厚涂", "赛璐璐", "水彩", "写实", "粗黑", "块面", "渐变"):
            self.assertNotIn(term, sketch["prompt"])
        self.app.dependency_overrides.clear()
        self.assertEqual(self.client.get("/api/prompt/presets").status_code, 401)

    def test_prompt_expansion_forwards_the_selected_preset_as_context(self):
        from server.ai_draw_service import get_ai_draw_service
        service = SimpleNamespace(generate_prompt=AsyncMock(return_value="扩写结果"))
        self.app.dependency_overrides[get_ai_draw_service] = lambda: service
        body = {"description": "头发飘动", "workflow_id": "minimax_h3_ref", "preset_prompt": "保持镜头固定。"}
        response = self.client.post("/api/prompt/generate", json=body)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"prompt": "扩写结果"})
        service.generate_prompt.assert_awaited_once_with("头发飘动", "minimax_h3_ref", user_id=1, preset_prompt="保持镜头固定。")
        service.generate_prompt.reset_mock()
        self.assertEqual(self.client.post("/api/prompt/generate", json={"description": "头发飘动"}).status_code, 200)
        service.generate_prompt.assert_awaited_once_with("头发飘动", None, user_id=1, preset_prompt="")
        self.assertEqual(self.client.post("/api/prompt/generate", json={**body, "preset_prompt": "长" * 8001}).status_code, 422)
        del self.app.dependency_overrides[self.user_dependency]
        self.assertEqual(self.client.post("/api/prompt/generate", json=body).status_code, 401)

    def test_image_validation_and_upstream_errors_are_distinct(self):
        for error, status in ((InvalidImageError("bad image"), 400), (RuntimeError("upstream unavailable"), 502)):
            with patch("server.api.prompt.describe_image", side_effect=error):
                response = self.client.post("/api/prompt/analyze-image", json={"image": "input", "description": "pose"})
                self.assertEqual(response.status_code, status)


if __name__ == "__main__":
    unittest.main()
