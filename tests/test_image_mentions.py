from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

from server.generation.contracts import GenerationParameters, ProviderInput
from server.generation.providers import OpenAIImageProvider, ProviderRegistry
from server.generation.qwen_image_21 import QwenImage21Provider
from server.generation.workflows import WorkflowCatalog
from utils.ai_prompt import AIPrompt
from utils.image_mentions import resolve_image_mentions, validate_image_mentions


class ImageMentionTests(unittest.TestCase):
    def test_converts_all_mentions_using_actual_compacted_image_order(self):
        prompt = "把@图片1的衣服换成@图片3的款式，参考<image3>。"
        references = ("first", None, "third")
        self.assertEqual(resolve_image_mentions(prompt, references, "qwen"), "把<image1>的衣服换成<image2>的款式，参考<image2>。")
        self.assertEqual(resolve_image_mentions(prompt, references, "ordinal"), "把第1张参考图的衣服换成第2张参考图的款式，参考第2张参考图。")
        ordinary = "普通文字 @ user@图片3.com email@example.com"
        self.assertEqual(resolve_image_mentions(ordinary, (), "qwen"), ordinary)

    def test_missing_removed_and_out_of_range_references_are_rejected(self):
        for prompt in ("@图片0", "@图片10", "@图片2", "<image2>", "@图片已移除"):
            with self.subTest(prompt=prompt), self.assertRaises(ValueError):
                validate_image_mentions(prompt, ("first", None, "third"))

    def test_catalog_validates_before_scheduling_and_keeps_plain_text_workflows(self):
        registry = ProviderRegistry()
        registry.register("fake", Mock())
        catalog = WorkflowCatalog({"image": {"provider": "fake", "supports_multi_image": True}, "text": {"provider": "fake"}}, registry)
        for prompt in ("@图片2", "@图片已移除"):
            with self.assertRaises(ValueError):
                catalog.validate(GenerationParameters(prompt, workflow="image", reference_image="first"))
        catalog.validate(GenerationParameters("@图片2", workflow="text"))
        catalog.validate(GenerationParameters("@图片1", workflow="image", reference_image="first"))

    def test_prompt_assistant_keeps_aliases_and_rejects_changed_or_missing_markers(self):
        assistant = AIPrompt.__new__(AIPrompt)
        assistant.prompt_template = "扩写：{desc}"
        assistant.llm = Mock()
        assistant.llm.complete.return_value = "保留@图片1构图，采用@图片2的颜色。"
        self.assertEqual(assistant.generate("把@图片1改成@图片2的颜色"), assistant.llm.complete.return_value)
        self.assertIn("原样保留", assistant.llm.complete.call_args.args[0])
        for output in ("改成蓝色", "采用<image1>和<image2>", "@图片1 @图片2 @图片3"):
            assistant.llm.complete.return_value = output
            with self.assertRaisesRegex(ValueError, "改变了图片引用"):
                assistant.generate("@图片1 @图片2")
        assistant.llm.complete.reset_mock()
        with self.assertRaisesRegex(ValueError, "已移除"):
            assistant.generate("@图片已移除")
        assistant.llm.complete.assert_not_called()

    def test_prompt_assistant_uses_selected_preset_only_as_context(self):
        assistant = AIPrompt.__new__(AIPrompt)
        assistant.prompt_template = "扩写：{desc}"
        assistant.llm = Mock()
        assistant.llm.complete.return_value = "服装参考@图片2，黑色无袖连体服。"
        preset = "@图片1 仅用于参考姿势，<image1> 的外观不照搬{保持}。"
        self.assertEqual(assistant.generate("服装参考@图片2", preset=preset), assistant.llm.complete.return_value)
        call = assistant.llm.complete.call_args
        # The preset is prepended at generation time, so it never enters the text to expand.
        self.assertTrue(call.args[0].startswith("扩写：服装参考@图片2"))
        self.assertNotIn("仅用于参考姿势", call.args[0])
        self.assertIn("图片1 仅用于参考姿势，图片1 的外观不照搬{保持}。", call.kwargs["system"])
        self.assertNotIn("@图片1", call.kwargs["system"])
        self.assertNotIn("<image1>", call.kwargs["system"])
        self.assertIn("不要复述", call.kwargs["system"])
        assistant.llm.complete.return_value = "服装参考@图片1。"
        with self.assertRaisesRegex(ValueError, "改变了图片引用"):
            assistant.generate("服装参考@图片2", preset=preset)
        assistant.generate("头发飘动", preset="  ")
        self.assertIsNone(assistant.llm.complete.call_args.kwargs["system"])


class ImageMentionProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_qwen_receives_native_tokens_but_saved_snapshot_keeps_user_text(self):
        prompt = "把@图片1的衣服换成@图片2的款式"
        parameters = GenerationParameters(prompt, workflow="qwen_image_21_i2i", reference_image="first", reference_image_2="second")
        comfyui = Mock()
        async def generate(**kwargs):
            kwargs["finish_callback"]("result")
        comfyui.generate_qwen_image_21 = AsyncMock(side_effect=generate)
        await QwenImage21Provider(comfyui).generate(ProviderInput(parameters, ("first", "second", None)))
        call = comfyui.generate_qwen_image_21.call_args.kwargs
        self.assertEqual(call["prompt_text"], "把<image1>的衣服换成<image2>的款式")
        self.assertEqual(call["images"], ["first", "second"])
        self.assertEqual(parameters.source_updates()["content"], prompt)

    async def test_gpt_receives_ordinal_references_and_the_same_image_order(self):
        parameters = GenerationParameters("参考@图片3和@图片1", workflow="gpt_image")
        client = Mock()
        client.generate.return_value = ["result"]
        with patch("utils.config_loader.get_gpt_image_config", return_value=SimpleNamespace(api_key="test", base_url="http://unused", model="test")), \
             patch("utils.openai_image.OpenAIImageGenerator", return_value=client):
            await OpenAIImageProvider().generate(ProviderInput(parameters, ("first", None, "third")))
        client.generate.assert_called_once_with("参考第2张参考图和第1张参考图", ["first", "third"])
        self.assertEqual(parameters.prompt, "参考@图片3和@图片1")


if __name__ == "__main__":
    unittest.main()
