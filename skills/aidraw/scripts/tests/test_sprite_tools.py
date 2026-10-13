"""sprite_tools on synthetic images: edges, sizing, tiling, frames and previews."""
import contextlib
import io
import json
import math
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import sprite_tools  # noqa: E402


def run(*argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = sprite_tools.main([str(item) for item in argv])
    return code, json.loads(out.getvalue())


class SpriteToolTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)

    def path(self, name):
        return self.root / name

    def character_on_white(self):
        """A dark figure with a white belly patch (inside the subject) on a white background."""
        image = Image.new("RGB", (200, 300), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((70, 40, 130, 280), fill=(40, 40, 60))
        draw.rectangle((90, 120, 110, 160), fill="white")
        image.save(self.path("figure.png"))
        return self.path("figure.png")

    def cutout_figure(self):
        """What a background-removal algorithm hands back: the same figure on a transparent canvas."""
        image = Image.new("RGBA", (200, 300), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.rectangle((70, 40, 130, 280), fill=(40, 40, 60, 255))
        draw.rectangle((90, 120, 110, 160), fill=(255, 255, 255, 255))
        image.save(self.path("cutout.png"))
        return self.path("cutout.png")

    def test_fit_height_puts_the_feet_on_the_bottom_edge(self):
        code, result = run("fit", self.cutout_figure(), "-o", self.path("fit.png"), "--height", "120", "--side-pad", "3")
        self.assertEqual(code, 0)
        with Image.open(self.path("fit.png")) as fitted:
            fitted.load()
        self.assertEqual(fitted.height, 120)
        box = fitted.getchannel("A").getbbox()
        self.assertEqual((box[1], box[3]), (0, 120))
        self.assertEqual(box[0], 3)
        self.assertEqual(fitted.width - box[2], 3)

    def test_fit_box_modes_produce_the_exact_texture_size(self):
        Image.new("RGBA", (400, 600), (200, 100, 50, 255)).save(self.path("prop.png"))
        for mode in ("contain", "cover", "stretch"):
            with self.subTest(mode=mode):
                code, result = run("fit", self.path("prop.png"), "-o", self.path(f"{mode}.png"), "--box", "170x290", "--mode", mode)
                self.assertEqual((code, tuple(result["size"])), (0, (170, 290)))

    def test_premultiplied_resize_keeps_edges_free_of_the_transparent_colour(self):
        image = Image.new("RGBA", (64, 64), (255, 255, 255, 0))
        ImageDraw.Draw(image).rectangle((16, 16, 47, 47), fill=(200, 0, 0, 255))
        smaller = sprite_tools.premultiplied_resize(image, (21, 21))
        for x in range(21):
            red, green, blue, alpha = smaller.getpixel((x, 10))
            if alpha:
                self.assertLess(green, 40, "no white halo from the transparent white")

    def test_defringe_replaces_halo_colour_but_keeps_alpha(self):
        image = Image.new("RGBA", (40, 40), (0, 0, 0, 0))
        ImageDraw.Draw(image).rectangle((10, 10, 29, 29), fill=(0, 0, 255, 255))
        image.putpixel((9, 20), (255, 255, 255, 128))
        image.save(self.path("halo.png"))
        run("defringe", self.path("halo.png"), "-o", self.path("clean.png"))
        with Image.open(self.path("clean.png")) as clean:
            clean.load()
        self.assertEqual(clean.getpixel((9, 20))[3], 128)
        self.assertGreater(clean.getpixel((9, 20))[2], 200)
        self.assertLess(clean.getpixel((9, 20))[0], 60)
        self.assertEqual(clean.getpixel((20, 20)), (0, 0, 255, 255))

    def test_tile_x_makes_a_seamless_strip_of_the_exact_width(self):
        # Smooth everywhere except the wrap from the last column back to the first.
        gradient = Image.new("RGB", (700, 100))
        for x in range(700):
            color = (int(128 + 100 * math.sin(x / 37)), int(128 + 100 * math.sin(x / 53)), 80)
            ImageDraw.Draw(gradient).line((x, 0, x, 99), fill=color)
        gradient.save(self.path("wide.png"))
        _, before = run("seam-check", self.path("wide.png"))
        code, result = run("tile-x", self.path("wide.png"), "-o", self.path("tile.png"), "--width", "512", "--blend", "96", "--opaque")
        self.assertEqual((code, tuple(result["size"])), (0, (512, 100)))
        self.assertGreater(before["seam_score_x"], 2)
        self.assertLessEqual(result["seam_score_x"], 1.8)
        with Image.open(self.path("tile.png")) as tile:
            self.assertEqual(tile.mode, "RGB")
        code, result = run("tile-x", self.path("wide.png"), "-o", self.path("x.png"), "--width", "650")
        self.assertEqual(code, 1)

    def test_previews_contact_sheet_mock_and_animation(self):
        frames = []
        for index in range(3):
            frame = Image.new("RGBA", (40, 80), (0, 0, 0, 0))
            ImageDraw.Draw(frame).rectangle((10, 10 + index * 5, 30, 79), fill=(220, 180, 40, 255))
            frame.save(self.path(f"f{index}.png"))
            frames.append(self.path(f"f{index}.png"))
        self.assertEqual(run("contact", *frames, "-o", self.path("sheet.png"), "--cell", "64")[1]["count"], 3)
        with Image.open(self.path("sheet.png")) as sheet:
            self.assertEqual(sheet.size, (192, 92))
        for suffix in ("gif", "png", "webp"):
            code, result = run("anim-preview", *frames, "-o", self.path(f"anim.{suffix}"), "--checker")
            self.assertEqual((code, result["frames"]), (0, 3))
        code, result = run("mock", frames[0], "-o", self.path("mock.png"), "--height", "230", "--both", "--x", "20")
        self.assertEqual(code, 0)
        with Image.open(self.path("mock.png")) as mock:
            self.assertEqual(mock.size, (1280 * 2 + 8, 720))
            unlit, lit = mock.getpixel((1000, 100)), mock.getpixel((1280 + 8 + 1000, 100))
        self.assertLess(sum(lit), sum(unlit) / 3, "ambient light darkens what the lights do not reach")

    def test_rectify_straightens_a_perspective_quad_into_an_upright_rectangle(self):
        image = Image.new("RGBA", (400, 300), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        quad = [(70, 40), (330, 30), (360, 270), (40, 262)]  # wider at the bottom, like looking up at it
        draw.polygon(quad, fill=(200, 210, 190, 255))
        draw.line((200, 35, 200, 266), fill=(20, 20, 20, 255), width=6)  # the middle mullion
        image.save(self.path("quad.png"))
        code, result = run("rectify", self.path("quad.png"), "-o", self.path("rect.png"), "--erode", "3")
        self.assertEqual(code, 0)
        for (x, y), (ex, ey) in zip(result["corners"], quad):
            self.assertLess(abs(x - ex) + abs(y - ey), 8)
        with Image.open(self.path("rect.png")) as rect:
            rect.load()
        alpha = rect.getchannel("A")
        self.assertEqual(alpha.getbbox(), (0, 0, rect.width, rect.height))
        inner = [alpha.getpixel((x, y)) for x in (4, rect.width - 5) for y in (4, rect.height - 5)]
        self.assertTrue(all(value > 200 for value in inner), "the corners are filled: the quad became the rectangle")
        column_darkness = [sum(rect.getpixel((x, y))[0] < 80 for y in range(10, rect.height - 10)) for x in range(rect.width)]
        mullion = max(range(rect.width), key=lambda x: column_darkness[x])
        self.assertGreater(column_darkness[mullion], (rect.height - 20) * 0.9, "the mullion is vertical after rectifying")
        code, result = run("rectify", self.path("quad.png"), "-o", self.path("x.png"), "--corners", "1,2;3,4")
        self.assertEqual(code, 1)

    def test_video_frames_become_an_aligned_sprite_sheet(self):
        import shutil
        import subprocess
        if not shutil.which("ffmpeg"):
            self.skipTest("ffmpeg is required")
        video = self.path("clip.mp4")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=white:size=96x128:rate=24", "-t", "1",
                        "-vf", "drawbox=x=40+5*sin(2*PI*t):y=30:w=20:h=90:color=0x283048:t=fill", "-pix_fmt", "yuv420p", str(video)], check=True)
        code, result = run("extract", video, "-o", self.path("frames"), "--fps", "8")
        self.assertEqual((code, result["frames"]), (0, 8))
        frames = sorted((self.root / "frames").glob("frame_*.png"))
        self.assertEqual(frames[0].name, "frame_000.png")
        (self.root / "cut").mkdir()
        for frame in frames:  # stand-in for `aidraw rmbg --variant …`: the white backdrop becomes transparent
            with Image.open(frame) as source:
                cut_frame = source.convert("RGBA")
            cut_frame.putalpha(cut_frame.convert("L").point(lambda value: 0 if value > 200 else 255))
            cut_frame.save(self.root / "cut" / frame.name)
        cut = sorted((self.root / "cut").glob("frame_*.png"))
        code, result = run("crop-frames", *cut, "-o", self.path("crop"), "--height", "60", "--pad", "2")
        self.assertEqual(code, 0)
        self.assertEqual(result["size"][1], 60)
        self.assertEqual(result["feet_bottom"][0], result["feet_bottom"][1], "one box for all frames keeps the feet still")
        cropped = sorted((self.root / "crop").glob("frame_*.png"))
        code, result = run("loop-scan", *cropped, "--min-length", "4", "--top", "3")
        self.assertEqual((code, result["frames"]), (0, 8))
        self.assertEqual(len(result["best"]), 3)
        self.assertTrue(all(item["length"] >= 4 for item in result["best"]))
        code, result = run("pack-sheet", *cropped, "-o", self.path("sheet.png"), "--json", self.path("sheet.json"), "--columns", "4")
        self.assertEqual((code, result["columns"], result["rows"], result["frames"]), (0, 4, 2, 8))
        meta = json.loads(self.path("sheet.json").read_text())
        with Image.open(self.path("sheet.png")) as sheet:
            self.assertEqual(sheet.size, (meta["frameWidth"] * 4, meta["frameHeight"] * 2))
        Image.new("RGBA", (5, 5)).save(self.path("odd.png"))
        self.assertEqual(run("pack-sheet", cropped[0], self.path("odd.png"), "-o", self.path("bad.png"))[0], 1)

    def test_extract_picks_frames_by_number_without_repeats(self):
        import shutil
        import subprocess
        from PIL import ImageChops
        if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
            self.skipTest("ffmpeg is required")
        video = self.path("counter.mp4")  # every frame differs
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=64x48:rate=24", "-t", "2",
                        "-pix_fmt", "yuv420p", str(video)], check=True)
        for fps, step, start, end, count in ((24, 1, "0.3", "1.8", 36), (8, 3, None, None, 16)):
            argv = ["extract", video, "-o", self.path(f"f{fps}"), "--fps", str(fps)] + (["--start", start, "--end", end] if start else [])
            code, result = run(*argv)
            self.assertEqual((code, result["source_fps"]), (0, 24.0))
            self.assertAlmostEqual(result["frames"], count, delta=1)
            self.assertEqual({b - a for a, b in zip(result["source_frames"], result["source_frames"][1:])}, {step})
            frames = [Image.open(path).convert("RGB") for path in sorted((self.root / f"f{fps}").glob("frame_*.png"))]
            self.assertTrue(all(ImageChops.difference(a, b).getbbox() for a, b in zip(frames, frames[1:])), f"no repeats at {fps} fps")

    def test_info_reports_background_and_alpha(self):
        code, result = run("info", self.character_on_white())
        facts = result["files"][0]
        self.assertEqual((code, facts["background_guess"], facts["transparent_ratio"]), (0, "#ffffff", 0.0))


if __name__ == "__main__":
    unittest.main()
