import unittest
import json
from pathlib import Path
from types import SimpleNamespace
from PIL import Image

from comfyui.structures.upscale_models import extract_upscale_model_options
from server.image_upscale_methods import build_upscale_method_registry
from utils.media_processor import (
    ImageUpscaleValidationError,
    decode_upscale_png_data_url,
    merge_upscaled_alpha,
    upscale_image_lanczos,
)


class ImageUpscaleTests(unittest.TestCase):
    @staticmethod
    def upscale_config():
        return SimpleNamespace(
            apisr_2x_model="apisr2.pth",
            apisr_4x_model="apisr4.pth",
            real_cugan_2x_model="cugan2.pth",
            real_cugan_4x_model="cugan4.pth",
            realesrgan_2x_model="esrgan2.pth",
            general_model="esrgan4.pth",
            general_native_scale=4,
            anime_model="anime4.pth",
            anime_native_scale=4,
        )

    def test_lanczos_returns_exact_size_and_preserves_alpha_mode(self):
        source = Image.new("RGBA", (3, 2), (20, 40, 60, 128))

        result = upscale_image_lanczos(source, 4)

        self.assertEqual(result.size, (12, 8))
        self.assertEqual(result.mode, "RGBA")
        self.assertEqual(result.getpixel((6, 4))[3], 128)

    def test_ai_rgb_result_reuses_resized_source_alpha(self):
        source = Image.new("RGBA", (2, 1), (10, 20, 30, 0))
        source.putpixel((1, 0), (10, 20, 30, 255))
        ai_result = Image.new("RGB", (8, 4), (200, 150, 100))

        result = merge_upscaled_alpha(source, ai_result, (4, 2))

        self.assertEqual(result.size, (4, 2))
        self.assertEqual(result.mode, "RGBA")
        self.assertEqual(result.getpixel((0, 0))[:3], (200, 150, 100))
        self.assertLess(result.getpixel((0, 0))[3], result.getpixel((3, 0))[3])

    def test_opaque_source_keeps_rgb_output(self):
        source = Image.new("RGB", (2, 2), (10, 20, 30))
        ai_result = Image.new("RGB", (8, 8), (200, 150, 100))

        result = merge_upscaled_alpha(source, ai_result, (4, 4))

        self.assertEqual(result.mode, "RGB")
        self.assertEqual(result.size, (4, 4))

    def test_model_options_support_current_comfyui_combo_shape(self):
        payload = {
            "UpscaleModelLoader": {
                "input": {
                    "required": {
                        "model_name": ["COMBO", {"options": ["general.pth", "anime.pth"]}],
                    },
                },
            },
        }

        self.assertEqual(extract_upscale_model_options(payload), ["general.pth", "anime.pth"])

    def test_model_options_support_legacy_list_shape(self):
        payload = {
            "UpscaleModelLoader": {
                "input": {
                    "required": {
                        "model_name": [["general.pth", "anime.pth"]],
                    },
                },
            },
        }

        self.assertEqual(extract_upscale_model_options(payload), ["general.pth", "anime.pth"])

    def test_upscale_decode_rejects_oversized_target_before_rgba_conversion(self):
        import base64
        from io import BytesIO

        source = Image.new("RGB", (2049, 1), (10, 20, 30))
        buffer = BytesIO()
        source.save(buffer, format="PNG")
        data_url = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")
        with self.assertRaisesRegex(ImageUpscaleValidationError, "4096px"):
            decode_upscale_png_data_url(data_url, 2, 4096, 16_777_216, 1024 * 1024)

    def test_upscale_decode_rejects_native_intermediate_beyond_limit(self):
        import base64
        from io import BytesIO

        source = Image.new("RGB", (1200, 200), (10, 20, 30))
        buffer = BytesIO()
        source.save(buffer, format="PNG")
        data_url = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")

        with self.assertRaisesRegex(ImageUpscaleValidationError, "中间图像"):
            decode_upscale_png_data_url(data_url, 2, 4096, 16_777_216, 1024 * 1024, processing_scale=4)

    def test_registry_exposes_four_named_ai_algorithm_groups(self):
        registry = build_upscale_method_registry(self.upscale_config())

        self.assertEqual(
            {method.algorithm_id for method in registry.values() if method.runner != "local"},
            {"apisr", "real_cugan", "realesrgan", "invsr"},
        )
        for method in registry.values():
            self.assertTrue(method.algorithm_name)
            self.assertTrue(method.architecture)
            self.assertTrue(method.behavior)

    def test_registry_reports_generic_model_availability_per_scale(self):
        registry = build_upscale_method_registry(self.upscale_config())
        available = registry["apisr"].availability({"apisr2.pth"}, False)

        self.assertTrue(available["available"])
        self.assertEqual(available["supported_scales"], [2])
        self.assertFalse(available["scale_availability"][1]["available"])

    def test_registry_reports_invsr_node_availability_for_both_scales(self):
        registry = build_upscale_method_registry(self.upscale_config())

        unavailable = registry["invsr"].availability(set(), False, invsr_error="节点缺失")
        available = registry["invsr"].availability(set(), True)

        self.assertFalse(unavailable["available"])
        self.assertEqual(unavailable["unavailable_reason"], "节点缺失")
        self.assertEqual(available["supported_scales"], [2, 4])

    def test_upscale_workflows_keep_required_titled_nodes(self):
        root = Path(__file__).resolve().parents[1]
        expected = {
            "image_upscale_workflow_api.json": {
                "main_image": "LoadImage",
                "upscale_model": "UpscaleModelLoader",
                "output_scale": "ImageScaleBy",
                "保存图像": "PreviewImage",
            },
            "image_upscale_invsr_workflow_api.json": {
                "main_image": "LoadImage",
                "invsr_loader": "LoadInvSRModels",
                "invsr_sampler": "InvSRSampler",
                "output_scale": "ImageScaleBy",
                "保存图像": "PreviewImage",
            },
        }
        for filename, titled_nodes in expected.items():
            workflow = json.loads((root / "configs" / "workflows" / filename).read_text(encoding="utf-8"))
            actual = {node.get("_meta", {}).get("title"): node["class_type"] for node in workflow.values()}
            for title, class_type in titled_nodes.items():
                self.assertEqual(actual[title], class_type)


if __name__ == "__main__":
    unittest.main()
