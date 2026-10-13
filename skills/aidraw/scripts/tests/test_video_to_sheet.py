"""video_to_sheet: a looping clip becomes a sheet aligned with the static sprite and registered in the project."""
import contextlib
import io
import json
import math
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import video_to_sheet  # noqa: E402


def white_backdrop_removed(*args):
    """Stand-in for `aidraw rmbg <frames> --variant V --out DIR`: the white backdrop becomes transparent."""
    assert args[0] == "rmbg", args
    files, out = args[1:args.index("--variant")], Path(args[args.index("--out") + 1])
    results = []
    for name in files:
        with Image.open(name) as source:
            image = source.convert("RGBA")
        image.putalpha(image.convert("L").point(lambda value: 0 if value > 200 else 255))
        image.save(out / Path(name).name)
        results.append({"source": name, "variant": args[args.index("--variant") + 1], "file": str(out / Path(name).name)})
    return {"ok": True, "results": results}


def make_clip(path: Path, seconds: float, rise) -> Path:
    """24 fps clip of a dark figure on white: the feet stay on row 140 while the top moves up by rise(t) pixels.
    (Drawn with Pillow: in ffmpeg's drawbox expressions `t` is the line thickness, not the time.)"""
    source = path.parent / f"{path.stem}_src"
    source.mkdir()
    for index in range(round(seconds * 24)):
        image = Image.new("RGB", (128, 160), "white")
        ImageDraw.Draw(image).rectangle((52, 40 - round(rise(index / 24)), 75, 139), fill=(40, 48, 72))
        image.save(source / f"f_{index:03d}.png")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", "24", "-i", str(source / "f_%03d.png"),
                    "-pix_fmt", "yuv420p", str(path)], check=True)
    return path


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg is required")
class VideoToSheetTests(unittest.TestCase):
    def test_sheet_matches_the_static_sprite_and_is_registered(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            # A dark figure 100 px tall whose top sways by 2 px (within the sprite's top padding); the clip loops.
            video = make_clip(root / "idle.mp4", 1, lambda t: -2 * math.sin(2 * math.pi * t))
            reference = Image.new("RGBA", (40, 68), (0, 0, 0, 0))
            ImageDraw.Draw(reference).rectangle((10, 2, 29, 65), fill=(40, 48, 72, 255))
            reference.save(root / "hero.png")
            (root / "public/assets/characters").mkdir(parents=True)
            pack = root / "public/assets/asset-pack.json"
            pack.write_text(json.dumps({"characters": {"files": []}, "meta": {"version": 2}}, indent=4))
            out = io.StringIO()
            with contextlib.redirect_stdout(out), patch.object(video_to_sheet.cutout_compare, "run_aidraw", white_backdrop_removed):
                code = video_to_sheet.main([str(video), "-o", str(root / "public/assets/characters/hero_idle.png"),
                                            "--work", str(root / "work"), "--match", str(root / "hero.png"), "--cutout", "birefnet-toonout",
                                            "--sample-fps", "8", "--play-fps", "6,8", "--pack", str(pack), "--key", "hero_idle",
                                            "--spec", str(root / "art/spec.json"), "--job", str(root / "art/jobs/idle.jsonl")])
            result = json.loads(out.getvalue())
            self.assertEqual(code, 0, result)
            self.assertEqual(result["frameHeight"], 68, "frame height equals the static sprite")
            self.assertLessEqual(result["feet_bottom"][1] - result["feet_bottom"][0], 1, "feet stay on one row")
            self.assertLessEqual(abs(result["feet_bottom"][1] - 66), 1, "feet on the same row as the static sprite")
            self.assertEqual(len(result["previews"]), 2)
            with Image.open(root / "public/assets/characters/hero_idle.png") as sheet:
                self.assertEqual(sheet.size, (result["columns"] * result["frameWidth"], 68 * -(-result["frames"] // result["columns"])))
            entry = json.loads(pack.read_text())["characters"]["files"][0]
            self.assertEqual((entry["type"], entry["key"], entry["url"]), ("spritesheet", "hero_idle", "assets/characters/hero_idle.png"))
            self.assertEqual(entry["frameConfig"], {"frameWidth": result["frameWidth"], "frameHeight": 68,
                                                    "endFrame": result["frames"] - 1})
            spec = json.loads((root / "art/spec.json").read_text())["assets"]["hero_idle"]
            self.assertEqual((spec["kind"], spec["status"], spec["frames"], spec["fps"]), ("animation", "generated", result["frames"], 6.0))
            self.assertEqual(spec["source"]["cutout"], "birefnet-toonout")
            self.assertIn('"event": "deliver"', (root / "art/jobs/idle.jsonl").read_text())
            failing = lambda *args: {"ok": False, "error": "HTTP 500: 移除背景失败"}  # noqa: E731
            out = io.StringIO()
            with contextlib.redirect_stdout(out), patch.object(video_to_sheet.cutout_compare, "run_aidraw", failing):
                code = video_to_sheet.main([str(video), "-o", str(root / "x.png"), "--work", str(root / "work2"), "--cutout", "rembg-u2net"])
            self.assertEqual(code, 1)
            self.assertIn("抠图失败", json.loads(out.getvalue())["error"])

    def test_rises_get_headroom_still_holds_are_trimmed_and_cutouts_are_reused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            # The top rises 12 px and comes back during the first second (feet fixed), then the clip just holds still.
            video = make_clip(root / "breath.mp4", 2, lambda t: 12 * math.sin(math.pi * min(t, 1)))
            reference = Image.new("RGBA", (40, 68), (0, 0, 0, 0))
            ImageDraw.Draw(reference).rectangle((10, 2, 29, 65), fill=(40, 48, 72, 255))
            reference.save(root / "hero.png")
            pack = root / "asset-pack.json"
            pack.write_text(json.dumps({"characters": {"files": []}}, indent=4))
            batches = []

            def counting(*args):
                batches.append(args[1:args.index("--variant")])
                return white_backdrop_removed(*args)

            argv = [str(video), "-o", str(root / "sheet.png"), "--work", str(root / "work"), "--match", str(root / "hero.png"),
                    "--cutout", "birefnet-toonout", "--sample-fps", "8", "--pack", str(pack), "--key", "hero_idle"]
            results = []
            for _ in range(2):
                out = io.StringIO()
                with contextlib.redirect_stdout(out), patch.object(video_to_sheet.cutout_compare, "run_aidraw", counting):
                    self.assertEqual(video_to_sheet.main(argv), 0, out.getvalue())
                results.append(json.loads(out.getvalue()))
            first, second = results
            self.assertGreaterEqual(first["trimmed_still"]["tail"], 5, "the hold at the end is dropped")
            self.assertEqual(first["trimmed_still"]["head"], 0)
            self.assertLessEqual(first["frames"], 9)
            self.assertGreater(first["frameHeight"], 68, "the frame grows instead of cutting the rise off")
            self.assertGreaterEqual(first["top_margin"], 3, "headroom above the highest frame")
            self.assertLessEqual(abs(first["frameHeight"] - first["feet_bottom"][1] - 2), 1, "feet as far from the bottom as in the sprite")
            self.assertEqual(first["blank_cells"], 0)
            entry = json.loads(pack.read_text())["characters"]["files"][0]
            self.assertEqual(entry["frameConfig"]["endFrame"], first["frames"] - 1)
            self.assertEqual(len(batches), 1, "the second run cuts nothing again")
            self.assertEqual(second["cutout_reused"], second["sampled"])
            same = lambda result: {k: v for k, v in result.items() if k not in ("cutout_reused", "registered")}  # noqa: E731
            self.assertEqual(same(first), same(second))


if __name__ == "__main__":
    unittest.main()
