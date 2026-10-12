"""video_to_sheet: a looping clip becomes a sheet aligned with the static sprite and registered in the project."""
import contextlib
import io
import json
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


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg is required")
class VideoToSheetTests(unittest.TestCase):
    def test_sheet_matches_the_static_sprite_and_is_registered(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / "idle.mp4"
            # A dark figure 90 px tall whose top sways; its feet stay on the same row; the clip loops.
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=white:size=128x160:rate=24", "-t", "1",
                            "-vf", "drawbox=x=52:y=40+3*sin(2*PI*t):w=24:h=100-3*sin(2*PI*t):color=0x283048:t=fill",
                            "-pix_fmt", "yuv420p", str(video)], check=True)
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
            self.assertEqual(entry["frameConfig"], {"frameWidth": result["frameWidth"], "frameHeight": 68})
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


if __name__ == "__main__":
    unittest.main()
