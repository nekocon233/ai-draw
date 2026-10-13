import io
import json
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

from PIL import Image, ImageChops

from utils.video_frames import (
    EXPORT_RECORD_KEY, build_spritesheet, extract_frame_items, normalize_frame_sizes, resize_frames, zip_frames,
)


class VideoFrameExportTests(unittest.TestCase):
    def test_spritesheet_keeps_soft_edges_and_records_its_layout(self):
        frames = [Image.new('RGBA', (4, 3), (255, 0, 0, 128)) for _ in range(5)]
        meta = {'source_video_url': '/uploads/video/1/v.mp4', 'source_fps': 24, 'fps': 24,
                'items': [{'index': index, 'time': index / 24} for index in range(5)]}

        png_bytes, cols, rows = build_spritesheet(frames, rows=2, meta=meta)
        sheet = Image.open(io.BytesIO(png_bytes))
        record = json.loads(sheet.text[EXPORT_RECORD_KEY])

        self.assertEqual(sheet.getpixel((0, 0)), (255, 0, 0, 128), 'half-transparent pixels are copied, not darkened')
        self.assertEqual(sheet.getpixel((9, 4))[3], 0, 'the blank sixth cell stays empty')
        self.assertEqual((record['frames'], record['cols'], record['rows']), (5, cols, rows))
        self.assertEqual((record['frame_width'], record['frame_height'], record['source_fps']), (4, 3, 24))
        self.assertEqual(record['items'][4]['time'], 4 / 24)

    def test_zip_carries_its_record_only_when_given(self):
        frames = [Image.new('RGBA', (2, 2), (0, 0, 0, 255)) for _ in range(3)]

        with zipfile.ZipFile(io.BytesIO(zip_frames(frames, meta={'fps': 12}))) as archive:
            record = json.loads(archive.read('meta.json'))
            self.assertEqual((record['frames'], record['fps']), (3, 12))
            self.assertEqual(len([name for name in archive.namelist() if name.endswith('.png')]), 3)
        with zipfile.ZipFile(io.BytesIO(zip_frames(frames))) as archive:
            self.assertNotIn('meta.json', archive.namelist())

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'ffmpeg is required')
    def test_frames_are_picked_by_frame_number_without_repeats(self):
        with tempfile.TemporaryDirectory() as directory:
            clip = Path(directory) / 'clip.mp4'
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=64x48:rate=24', '-t', '2',
                            '-pix_fmt', 'yuv420p', str(clip)], check=True)
            for fps, step in ((24, 1), (8, 3)):
                items = extract_frame_items(clip, fps=fps, start_time=0.3, end_time=1.8)
                self.assertAlmostEqual(len(items), 1.5 * fps, delta=1)
                self.assertTrue(all(ImageChops.difference(a.image, b.image).getbbox() for a, b in zip(items, items[1:])),
                                f'no frame repeats at {fps} fps')
                self.assertEqual({b.source_index - a.source_index for a, b in zip(items, items[1:])}, {step})
                self.assertTrue(all(abs((b.time - a.time) - step / 24) < 1e-6 for a, b in zip(items, items[1:])))

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
