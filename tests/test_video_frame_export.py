import io
import unittest

from PIL import Image

from utils.video_frames import build_spritesheet, normalize_frame_sizes, resize_frames


class VideoFrameExportTests(unittest.TestCase):
    def test_spritesheet_defaults_to_one_row(self):
        frames = [Image.new('RGBA', (4, 3), (index, 0, 0, 255)) for index in range(3)]

        png_bytes, cols, rows = build_spritesheet(frames)
        sheet = Image.open(io.BytesIO(png_bytes))

        self.assertEqual((cols, rows), (3, 1))
        self.assertEqual(sheet.size, (12, 3))

    def test_mixed_sizes_use_largest_canvas_without_stretching(self):
        wide = Image.new('RGBA', (8, 4), (255, 0, 0, 255))
        tall = Image.new('RGBA', (2, 4), (0, 255, 0, 255))

        normalized = normalize_frame_sizes([wide, tall])

        self.assertEqual([frame.size for frame in normalized], [(8, 4), (8, 4)])
        self.assertEqual(normalized[1].getpixel((0, 2))[3], 0)
        self.assertEqual(normalized[1].getpixel((3, 2))[:3], (0, 255, 0))

    def test_requested_rows_determine_columns(self):
        frames = [Image.new('RGBA', (2, 2), (0, 0, 0, 255)) for _ in range(5)]

        _, cols, rows = build_spritesheet(frames, rows=2)

        self.assertEqual((cols, rows), (3, 2))

    def test_single_explicit_dimension_uses_largest_canvas_ratio(self):
        frames = [
            Image.new('RGBA', (8, 4), (0, 0, 0, 255)),
            Image.new('RGBA', (4, 6), (0, 0, 0, 255)),
        ]

        resized = resize_frames(frames, width=16)

        self.assertEqual([frame.size for frame in resized], [(16, 12), (16, 12)])


if __name__ == '__main__':
    unittest.main()
