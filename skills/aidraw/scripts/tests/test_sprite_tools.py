"""sprite_tools on synthetic images: keying, edges, sizing, tiling and previews."""
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

    def test_key_removes_only_background_connected_to_the_border(self):
        code, result = run("key", self.character_on_white(), "-o", self.path("keyed.png"), "--feather", "0")
        self.assertEqual(code, 0)
        self.assertEqual(result["color"], "#ffffff")
        with Image.open(self.path("keyed.png")) as keyed:
            self.assertEqual(keyed.getpixel((5, 5))[3], 0)
            self.assertEqual(keyed.getpixel((100, 140))[3], 255, "white inside the subject stays opaque")
            self.assertEqual(keyed.getpixel((80, 200))[3], 255)

    def test_fit_height_puts_the_feet_on_the_bottom_edge(self):
        run("key", self.character_on_white(), "-o", self.path("keyed.png"), "--feather", "0")
        code, result = run("fit", self.path("keyed.png"), "-o", self.path("fit.png"), "--height", "120", "--side-pad", "3")
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

    def test_info_reports_background_and_alpha(self):
        code, result = run("info", self.character_on_white())
        facts = result["files"][0]
        self.assertEqual((code, facts["background_guess"], facts["transparent_ratio"]), (0, "#ffffff", 0.0))


if __name__ == "__main__":
    unittest.main()
