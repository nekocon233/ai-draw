import base64
import tempfile
import unittest
from io import BytesIO
from pathlib import Path

from PIL import Image

from utils.image_reference import normalize_image_reference


class ImageReferenceTests(unittest.TestCase):
    @staticmethod
    def png_bytes() -> bytes:
        output = BytesIO()
        Image.new("RGB", (2, 2), (20, 40, 60)).save(output, format="PNG")
        return output.getvalue()

    def test_accepts_data_url_and_raw_base64(self):
        encoded = base64.b64encode(self.png_bytes()).decode("ascii")

        self.assertEqual(normalize_image_reference(f"data:image/png;base64,{encoded}", "uploads"), encoded)
        self.assertEqual(normalize_image_reference(encoded, "uploads"), encoded)

    def test_reads_generated_image_from_upload_url(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            generated_dir = Path(temp_dir) / "generated"
            generated_dir.mkdir()
            image_path = generated_dir / "result.png"
            image_path.write_bytes(self.png_bytes())

            encoded = normalize_image_reference("/uploads/generated/result.png", temp_dir)

            self.assertEqual(base64.b64decode(encoded), self.png_bytes())

    def test_reads_absolute_local_upload_url(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "result.png"
            image_path.write_bytes(self.png_bytes())

            encoded = normalize_image_reference("https://aidraw.example/uploads/result.png", temp_dir)

            self.assertEqual(base64.b64decode(encoded), self.png_bytes())

    def test_rejects_non_image_base64_before_comfyui(self):
        encoded = base64.b64encode(b"not an image").decode("ascii")

        with self.assertRaisesRegex(ValueError, "不是有效的图片文件"):
            normalize_image_reference(encoded, "uploads", "参考图 1")

    def test_rejects_upload_path_traversal(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with self.assertRaisesRegex(ValueError, "路径无效"):
                normalize_image_reference("/uploads/../secret.png", temp_dir)


if __name__ == "__main__":
    unittest.main()
