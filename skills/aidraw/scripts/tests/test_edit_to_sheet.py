"""edit_to_sheet: the user's 编辑帧 export becomes the same kind of sheet video_to_sheet delivers."""
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

from PIL import Image, ImageDraw, PngImagePlugin

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import edit_to_sheet  # noqa: E402

RISES = [0, 4, 8, 8, 4, 1]  # frame 3 repeats frame 2


def figure(rise: int, backdrop=(0, 0, 0, 0)) -> Image.Image:
    """A 128×160 frame in the clip's coordinates: a dark figure with its feet on row 140 and its top lifted by `rise`."""
    image = Image.new("RGBA", (128, 160), backdrop)
    ImageDraw.Draw(image).rectangle((52, 40 - rise, 75, 139), fill=(40, 48, 72, 255))
    return image


def export_sheet(path: Path, frames: list, columns: int, rows: int, meta=None) -> Path:
    """What 编辑帧 exports: the frames row by row on a transparent sheet, optionally with its "ai-draw" record."""
    sheet = Image.new("RGBA", (columns * 128, rows * 160), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        sheet.paste(frame, ((index % columns) * 128, (index // columns) * 160))
    info = None
    if meta is not None:
        info = PngImagePlugin.PngInfo()
        info.add_itxt("ai-draw", json.dumps(meta))
    sheet.save(path, pnginfo=info)
    return path


def white_backdrop_removed(*args):
    """Stand-in for `aidraw rmbg <frames> --variant V --out DIR`: the white backdrop becomes transparent."""
    files, out = args[1:args.index("--variant")], Path(args[args.index("--out") + 1])
    for name in files:
        with Image.open(name) as source:
            image = source.convert("RGBA")
        image.putalpha(image.convert("L").point(lambda value: 0 if value > 200 else 255))
        image.save(out / Path(name).name)
    return {"ok": True}


def no_cutout(*args):
    raise AssertionError(f"the user's own cutout must not be redone: {args[:1]}")


class EditToSheetTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        reference = Image.new("RGBA", (40, 68), (0, 0, 0, 0))
        ImageDraw.Draw(reference).rectangle((10, 2, 29, 65), fill=(40, 48, 72, 255))
        reference.save(self.root / "hero.png")
        self.pack = self.root / "asset-pack.json"
        self.pack.write_text(json.dumps({"characters": {"files": []}}, indent=4))

    def run_tool(self, export, *extra, run_aidraw=no_cutout):
        argv = [str(export), "-o", str(self.root / "sheet.png"), "--work", str(self.root / "work"),
                "--match", str(self.root / "hero.png"), *map(str, extra)]
        out = io.StringIO()
        with contextlib.redirect_stdout(out), patch.object(edit_to_sheet.sheets.cutout_compare, "run_aidraw", run_aidraw):
            code = edit_to_sheet.main(argv)
        return code, json.loads(out.getvalue())

    def test_export_with_its_record_is_delivered_as_exported(self):
        meta = {"version": 1, "frames": 6, "cols": 4, "rows": 2, "frame_width": 128, "frame_height": 160, "fps": 12,
                "playback_fps": 6, "source_fps": 24, "source_video_url": "/uploads/video/1/v.mp4",
                "items": [{"index": index, "time": index / 12, "width": 128, "height": 160, "source_width": 128,
                           "source_height": 160} for index in range(6)]}
        export = export_sheet(self.root / "export.png", [figure(rise) for rise in RISES], 4, 2, meta)
        code, result = self.run_tool(export, "--pack", self.pack, "--key", "hero_idle", "--spec", self.root / "spec.json",
                                     "--job", self.root / "job.jsonl", "--source-url", "/uploads/spritesheet/1/v_e.png")
        self.assertEqual(code, 0, result)
        self.assertEqual((result["frames"], result["fps"], result["fps_from"], result["grid"]), (6, 12.0, "metadata", [4, 2]))
        self.assertEqual((result["duplicates"], result["source_frames"], result["blank_cells"]), ([3], [0, 10], 0))
        self.assertTrue(any("完全一样" in warning for warning in result["warnings"]))
        self.assertTrue(any("预览速度是每秒 6 帧" in warning for warning in result["warnings"]), "real-time speed wins")
        self.assertGreater(result["frameHeight"], 68, "the 8 px rise gets room instead of being cut off")
        self.assertLessEqual(abs(result["frameHeight"] - result["feet_bottom"][1] - 2), 1, "feet where the sprite has them")
        self.assertEqual(json.loads(self.pack.read_text())["characters"]["files"][0]["frameConfig"]["endFrame"], 5)
        spec = json.loads((self.root / "spec.json").read_text())["assets"]["hero_idle"]
        self.assertEqual((spec["kind"], spec["frames"], spec["fps"]), ("animation", 6, 12.0))
        self.assertEqual(spec["source"]["edited_by_user"], "/uploads/spritesheet/1/v_e.png")
        self.assertIn('"step": "user-edit"', (self.root / "job.jsonl").read_text())

    def test_older_export_without_a_record_finds_its_grid(self):
        export = export_sheet(self.root / "export.png", [figure(rise) for rise in RISES], 4, 2)
        code, result = self.run_tool(export, "--fps", "10")
        self.assertEqual(code, 0, result)
        self.assertEqual((result["frames"], result["grid"], result["fps"], result["metadata"]), (6, [4, 2], 10.0, False))
        code, result = self.run_tool(export, "--fps", "10", "--drop-duplicates")
        self.assertEqual((code, result["frames"], result["duplicates"]), (0, 5, [3]))
        code, result = self.run_tool(export)
        self.assertEqual((code, result["fps"], result["fps_from"]), (0, 8.0, "default"))
        self.assertTrue(any("帧率先按 8" in warning for warning in result["warnings"]))

    def test_frames_still_on_their_backdrop_get_the_projects_cutout(self):
        meta = {"frames": 6, "cols": 3, "rows": 2, "frame_width": 128, "frame_height": 160, "fps": 12}
        export = export_sheet(self.root / "export.png", [figure(rise, (255, 255, 255, 255)) for rise in RISES], 3, 2, meta)
        code, result = self.run_tool(export)
        self.assertEqual(code, 1)
        self.assertIn("--cutout", result["error"])
        code, result = self.run_tool(export, "--cutout", "birefnet-toonout", run_aidraw=white_backdrop_removed)
        self.assertEqual((code, result["frames"], result["cutout"]), (0, 6, "birefnet-toonout"), result)

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg is required")
    def test_frame_rate_and_framing_come_from_the_clip(self):
        # A 24 fps clip whose top rises a pixel per frame; the user exported every second frame on transparency.
        source = self.root / "clip"
        source.mkdir()
        for index in range(24):
            figure(index, (255, 255, 255, 255)).convert("RGB").save(source / f"f_{index:03d}.png")
        video = self.root / "clip.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", "24", "-i", str(source / "f_%03d.png"),
                        "-pix_fmt", "yuv420p", str(video)], check=True)
        export = export_sheet(self.root / "export.png", [figure(index) for index in range(0, 24, 2)], 4, 3)
        (self.root / "previous.json").write_text(json.dumps({"crop_box": [37, 37, 91, 143], "frameWidth": 35, "frameHeight": 68}))
        code, result = self.run_tool(export, "--video", video, "--framing-from", self.root / "previous.json")
        self.assertEqual(code, 0, result)
        self.assertEqual((result["fps"], result["fps_from"], result["grid"]), (12.0, "video", [4, 3]))
        self.assertEqual((result["source_frames"], result["framing"], result["frameWidth"]), ([0, 22], "framing-from", 35))
        self.assertGreater(result["frameHeight"], 68, "the 22 px rise grows the delivered frame")


if __name__ == "__main__":
    unittest.main()
