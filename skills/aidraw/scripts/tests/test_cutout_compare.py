"""cutout_compare: every algorithm's result cleaned alike, laid out on one sheet, with kept backdrop measurable."""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cutout_compare  # noqa: E402

FIGURE = (30, 20, 90, 180)   # an arch: two legs joined at the top
GAP = (50, 90, 70, 180)      # white between the legs, enclosed by the figure on three sides and the floor line


def arch_on_white(path: Path) -> None:
    image = Image.new("RGB", (120, 200), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle(FIGURE, fill=(40, 40, 60))
    draw.rectangle(GAP, fill="white")
    image.save(path)


def fake_all_algorithms(*args):
    """Stand-in for `aidraw rmbg IMAGE --all --out DIR`: one clean cut, one that keeps the gap, one broken model."""
    assert args[:3] == ("rmbg", args[1], "--all"), args
    source, out = Path(args[1]), Path(args[args.index("--out") + 1])
    with Image.open(source) as opened:
        image = opened.convert("RGBA")
    figure = Image.new("L", image.size, 0)
    ImageDraw.Draw(figure).rectangle(FIGURE, fill=255)
    clean_cut = figure.copy()
    ImageDraw.Draw(clean_cut).rectangle(GAP, fill=0)
    results = []
    for variant, label, alpha in (("birefnet-toonout", "BiRefNet · ToonOut", clean_cut), ("rembg-u2net", "rembg · u2net", figure)):
        cut = image.copy()
        cut.putalpha(alpha)
        target = out / f"{source.stem}.{variant}.png"
        cut.save(target)
        results.append({"source": str(source), "variant": variant, "label": label, "file": str(target), "seconds": 1.0})
    results.insert(1, {"source": str(source), "variant": "birefnet-dynamic", "label": "BiRefNet · dynamic", "error": "HTTP 500"})
    return {"ok": True, "results": results}


class CutoutCompareTests(unittest.TestCase):
    def test_sheet_numbers_every_algorithm_and_flags_kept_backdrop(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            arch_on_white(root / "frame.png")
            out = io.StringIO()
            with contextlib.redirect_stdout(out), patch.object(cutout_compare, "run_aidraw", fake_all_algorithms):
                code = cutout_compare.main([str(root / "frame.png"), "--work", str(root / "cmp"), "--job", str(root / "job.jsonl")])
            result = json.loads(out.getvalue())
            self.assertEqual(code, 0, result)
            self.assertEqual([item["n"] for item in result["variants"]], [1, 2, 3])
            self.assertEqual([item["variant"] for item in result["variants"]], ["birefnet-toonout", "birefnet-dynamic", "rembg-u2net"])
            self.assertEqual(result["variants"][1]["error"], "HTTP 500")
            clean, kept = result["variants"][0], result["variants"][2]
            self.assertEqual(clean["bg_like"], 0.0)
            self.assertGreater(kept["bg_like"], 0.1, "white left between the legs shows up in the number")
            self.assertTrue(Path(clean["file"]).exists() and Path(kept["file"]).exists())
            for name in ("compare", "compare_dark"):
                with Image.open(result[name]) as sheet:
                    self.assertEqual(sheet.size, (3 * cutout_compare.CELL[0], cutout_compare.CELL[1] + cutout_compare.LABEL))
            with Image.open(result["compare"]) as sheet:
                tile_centre = (cutout_compare.CELL[0] // 2, cutout_compare.LABEL + cutout_compare.CELL[1] // 2)
                self.assertEqual(sheet.getpixel((5, cutout_compare.LABEL + 5)), (255, 0, 255), "magenta backdrop")
                self.assertNotEqual(sheet.getpixel(tile_centre), (255, 255, 255))
            self.assertTrue((root / "cmp" / "compare.json").exists())
            self.assertIn('"event": "cutout_compare"', (root / "job.jsonl").read_text())

    def test_a_failed_comparison_is_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            arch_on_white(root / "frame.png")
            out = io.StringIO()
            failing = lambda *args: {"ok": False, "error": "全部算法都失败了"}  # noqa: E731
            with contextlib.redirect_stdout(out), patch.object(cutout_compare, "run_aidraw", failing):
                code = cutout_compare.main([str(root / "frame.png"), "--work", str(root / "cmp")])
            self.assertEqual((code, json.loads(out.getvalue())["error"]), (1, "全部算法都失败了"))


if __name__ == "__main__":
    unittest.main()
