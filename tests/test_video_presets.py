"""Video preset routing, keyframe requirements and native provider payloads."""
import base64
import unittest
from dataclasses import replace
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import yaml
from PIL import Image

from server.api.prompt import PROMPT_PRESETS
from server.generation.contracts import GenerationParameters, TaskContext
from server.generation.engine import GenerationEngine
from server.generation.providers import build_provider_registry
from server.generation.workflows import WorkflowCatalog
from server.schemas import PromptPreset


class VideoPresetTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.presets = {preset.id: preset.model_dump() for preset in PROMPT_PRESETS}
        self.comfyui = SimpleNamespace(
            **{name: AsyncMock(side_effect=lambda finish_callback, **kwargs: finish_callback(b"video"))
               for name in ("generate_minimax_h3", "generate_minimax_h3_ref")},
            interrupt=AsyncMock(), switch_workflow=Mock(),
        )
        root = Path(__file__).resolve().parents[1]
        metadata = yaml.safe_load((root / "configs/app_config.yaml").read_text())["workflow_defaults"]["workflow_metadata"]
        self.catalog = WorkflowCatalog(metadata, build_provider_registry(self.comfyui))
        self.storage = SimpleNamespace(upload_dir="/unused", save=AsyncMock(return_value="/uploads/video/7/result.mp4"))
        self.engine = GenerationEngine(self.catalog, self.storage)
        buffer = BytesIO()
        Image.new("RGB", (3, 2), "red").save(buffer, "PNG")
        self.image = base64.b64encode(buffer.getvalue()).decode()

    def parameters(self, preset="video_motion", workflow="minimax_h3", **kwargs):
        return GenerationParameters("抬起右手", workflow=workflow, prompt_preset=self.presets[preset], **kwargs)

    def test_catalog_exposes_video_scope_and_explicit_keyframe_roles(self):
        videos = [preset for preset in PROMPT_PRESETS if preset.output_type == "video"]
        self.assertEqual({preset.id for preset in videos}, {"video_motion", "video_fixed_camera", "video_transition"})
        for preset in videos:
            self.assertTrue(preset.prompt.endswith("。"))
            self.assertNotIn("@图片", preset.prompt)
            self.assertEqual(PromptPreset.model_validate(preset.model_dump()), preset)
        self.assertEqual([image.slot for image in videos[-1].images], [1, "end"])
        self.assertEqual(self.catalog.describe('minimax_h3')['method'], 'MiniMax H3 · 首尾帧')
        self.assertEqual(self.catalog.describe('minimax_h3')['default_prompt_preset_id'], 'video_transition')
        self.assertEqual(self.catalog.describe('minimax_h3_ref')['default_prompt_preset_id'], 'video_fixed_camera')

    def test_current_video_presets_are_scoped_to_their_h3_workflows(self):
        for preset in ('video_motion', 'video_transition'):
            for workflow in ('minimax_h3_ref',):
                with self.subTest(preset=preset, workflow=workflow), self.assertRaisesRegex(ValueError, '不适用于'):
                    self.engine.validate(self.parameters(preset, workflow, reference_image=self.image, reference_image_end=self.image))

    def test_presets_cannot_cross_image_and_video_workflows(self):
        for preset, workflow in (("sketch_finish", "minimax_h3"), ("video_motion", "qwen_image_21_i2i")):
            with self.subTest(preset=preset), self.assertRaisesRegex(ValueError, "不匹配"):
                self.engine.validate(self.parameters(preset, workflow, reference_image=self.image))

    def test_image_to_video_presets_require_a_start_even_when_workflow_images_are_optional(self):
        for workflow in ("minimax_h3",):
            params = self.parameters(workflow=workflow)
            with self.subTest(workflow=workflow), self.assertRaisesRegex(ValueError, "开始帧"):
                self.engine.validate(params)
            self.engine.validate(replace(params, reference_image=self.image))
        # MiniMax still supports text-only generation without an image-dependent preset.
        self.engine.validate(GenerationParameters("云层流动", workflow="minimax_h3"))

    def test_transition_requires_real_end_slot_and_a_capable_workflow(self):
        for workflow in ("minimax_h3",):
            params = self.parameters("video_transition", workflow, reference_image=self.image, reference_image_2=self.image)
            with self.subTest(workflow=workflow), self.assertRaisesRegex(ValueError, "结束帧"):
                self.engine.validate(params)
            self.engine.validate(replace(params, reference_image_2=None, reference_image_end=self.image))
        with self.assertRaisesRegex(ValueError, "不适用于"):
            self.engine.validate(self.parameters("video_transition", "minimax_h3_ref", reference_image=self.image, reference_image_end=self.image))

    async def test_fixed_camera_requires_ordered_motion_references_and_keeps_extra_text_separate(self):
        for workflow in ('minimax_h3',):
            with self.subTest(workflow=workflow), self.assertRaisesRegex(ValueError, '不适用于'):
                self.engine.validate(self.parameters('video_fixed_camera', workflow, reference_image=self.image))
        params = self.parameters('video_fixed_camera', 'minimax_h3_ref', reference_image=self.image)
        with self.assertRaisesRegex(ValueError, '动作参考图'):
            self.engine.validate(params)
        params = replace(params, prompt='补充两声短铃', motion_reference_images=[self.image, self.image])
        self.engine.validate(params)
        await self.engine.generate(params, TaskContext(7,'task','minimax_h3_ref'), Mock(), lambda: None)
        sent = self.comfyui.generate_minimax_h3_ref.await_args.kwargs
        self.assertEqual(len(sent['images']), 3)
        self.assertIn('reference images determine all basic actions, poses and order', sent['prompt_text'])
        self.assertIn('文字与动作图冲突时，以动作参考图为准', sent['prompt_text'])
        self.assertEqual(params.source_updates()['content'], '补充两声短铃')

    def test_old_fixed_camera_snapshot_without_motion_requirement_remains_valid(self):
        legacy = {'id':'video_fixed_camera','title':'固定镜头动作','output_type':'video',
                  'prompt':'固定镜头，按补充描述完成动作。','images':[{'label':'开始帧','role':'主体','slot':1}]}
        params = GenerationParameters('抬手', workflow='minimax_h3', reference_image=self.image, prompt_preset=legacy)
        self.engine.validate(params)
        self.assertEqual(params.for_provider().prompt, legacy['prompt']+'抬手')

    def test_legacy_image_snapshot_still_validates_without_new_fields(self):
        preset = {"id": "legacy", "title": "参考", "prompt": "@图片1 保持构图。", "images": [{"label": "图 1", "role": "构图"}]}
        params = GenerationParameters("补全细节", workflow="gpt_image", prompt_preset=preset, reference_image=self.image)
        self.engine.validate(params)
        self.assertEqual(params.for_provider().prompt, "@图片1 保持构图。补全细节")

    async def test_native_video_receives_preset_plus_description_and_both_keyframes(self):
        params = self.parameters("video_transition", reference_image=self.image, reference_image_end=self.image)
        self.engine.validate(params)
        await self.engine.generate(params, TaskContext(7, "task", "minimax_h3"), Mock(), lambda: None)
        sent = self.comfyui.generate_minimax_h3.await_args.kwargs
        self.assertEqual(sent["prompt_text"], self.presets["video_transition"]["prompt"] + "抬起右手")
        self.assertEqual((sent["start_image_base64"], sent["end_image_base64"]), (self.image, self.image))
        self.assertEqual(params.source_updates()["content"], "抬起右手")
        self.assertEqual(params.source_updates()["prompt_preset"], params.prompt_preset)


if __name__ == "__main__":
    unittest.main()
