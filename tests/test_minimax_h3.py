import json
import unittest
from copy import deepcopy
from pathlib import Path

from comfyui.structures.minimax_h3 import (
    get_minimax_h3_frame_count,
    get_minimax_h3_resolution,
    remove_nodes_by_title,
    validate_minimax_h3_options,
)


class MiniMaxH3Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[1]
        cls.workflow = json.loads(
            (root / "configs" / "workflows" / "minimax_h3_workflow_api.json").read_text(
                encoding="utf-8"
            )
        )

    def test_duration_aligns_to_h3_frame_grid(self):
        self.assertEqual(get_minimax_h3_frame_count(4), 107)
        self.assertEqual(get_minimax_h3_frame_count(5), 124)
        self.assertEqual(get_minimax_h3_frame_count(15), 362)
        for duration in (4, 5, 6, 8, 10, 12, 15):
            self.assertEqual(get_minimax_h3_frame_count(duration) % 17, 5)

    def test_duration_rejects_values_outside_trained_range(self):
        with self.assertRaisesRegex(ValueError, "4 到 15"):
            get_minimax_h3_frame_count(3.9)
        with self.assertRaisesRegex(ValueError, "4 到 15"):
            get_minimax_h3_frame_count(15.1)

    def test_options_reject_unknown_or_invalid_values(self):
        self.assertEqual(validate_minimax_h3_options(None), (5.0, "auto"))
        self.assertEqual(
            validate_minimax_h3_options({"h3_duration": "10", "h3_aspect_ratio": "9:16"}),
            (10.0, "9:16"),
        )
        with self.assertRaisesRegex(ValueError, "未知参数"):
            validate_minimax_h3_options({"duration": "5"})
        with self.assertRaisesRegex(ValueError, "不支持画幅"):
            validate_minimax_h3_options({"h3_aspect_ratio": "2:1"})

    def test_resolution_presets_match_h3_native_canvas(self):
        self.assertEqual(get_minimax_h3_resolution("16:9"), (1344, 768))
        self.assertEqual(get_minimax_h3_resolution("9:16"), (768, 1344))
        self.assertEqual(get_minimax_h3_resolution("21:9"), (1536, 672))
        for width, height in map(get_minimax_h3_resolution, ("16:9", "9:16", "1:1", "4:3", "3:4", "21:9")):
            self.assertEqual(width % 32, 0)
            self.assertEqual(height % 32, 0)
            self.assertLessEqual(width * height, 768 * 1344)

    def test_auto_resolution_follows_keyframe_aspect_ratio(self):
        self.assertEqual(get_minimax_h3_resolution("auto"), (1344, 768))
        self.assertEqual(get_minimax_h3_resolution("auto", [(1200, 800)]), (1152, 768))
        self.assertEqual(get_minimax_h3_resolution("auto", [(800, 1200)]), (768, 1152))
        self.assertEqual(
            get_minimax_h3_resolution("auto", [(1920, 1080), (1280, 720)]),
            (1344, 768),
        )

    def test_auto_resolution_rejects_mismatched_keyframes(self):
        with self.assertRaisesRegex(ValueError, "首尾关键帧比例不一致"):
            get_minimax_h3_resolution("auto", [(1920, 1080), (1080, 1920)])

    def test_workflow_contains_required_native_nodes(self):
        actual = {
            node.get("_meta", {}).get("title"): node["class_type"]
            for node in self.workflow.values()
        }
        expected = {
            "main_image_start": "LoadImage",
            "main_image_end": "LoadImage",
            "h3_conditioning": "MiniMaxH3ImageToVideo",
            "seed": "RandomNoise",
            "h3_decode_video": "VAEDecode",
            "h3_decode_audio": "VAEDecodeAudio",
            "h3_mux_video": "CreateVideo",
            "保存视频": "SaveVideo",
        }
        for title, class_type in expected.items():
            self.assertEqual(actual[title], class_type)

    def test_optional_keyframe_nodes_are_removed_independently(self):
        workflow = deepcopy(self.workflow)
        remove_nodes_by_title(workflow, ["main_image_start"])
        conditioning = next(
            node for node in workflow.values()
            if node.get("_meta", {}).get("title") == "h3_conditioning"
        )
        titles = {node.get("_meta", {}).get("title") for node in workflow.values()}
        self.assertNotIn("main_image_start", titles)
        self.assertNotIn("first_frame", conditioning["inputs"])
        self.assertIn("main_image_end", titles)
        self.assertIn("last_frame", conditioning["inputs"])

        workflow = deepcopy(self.workflow)
        remove_nodes_by_title(workflow, ["main_image_end"])
        conditioning = next(
            node for node in workflow.values()
            if node.get("_meta", {}).get("title") == "h3_conditioning"
        )
        self.assertIn("first_frame", conditioning["inputs"])
        self.assertNotIn("last_frame", conditioning["inputs"])

        workflow = deepcopy(self.workflow)
        remove_nodes_by_title(workflow, ["main_image_start", "main_image_end"])
        conditioning = next(
            node for node in workflow.values()
            if node.get("_meta", {}).get("title") == "h3_conditioning"
        )
        self.assertNotIn("first_frame", conditioning["inputs"])
        self.assertNotIn("last_frame", conditioning["inputs"])


if __name__ == "__main__":
    unittest.main()
