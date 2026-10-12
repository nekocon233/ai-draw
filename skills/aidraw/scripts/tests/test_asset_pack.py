"""asset_pack: registration keeps the pack's layout; the spec drives delivery checks."""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import asset_pack  # noqa: E402

PACK = {
    "characters": {"files": [{"url": "assets/characters/heroine.png", "type": "image", "key": "heroine"}]},
    "audio": {"files": [{"type": "audio", "key": "step", "url": ["assets/audio/step.ogg"]}]},
    "meta": {"app": "Phaser Editor 2D - Asset Pack Editor", "version": 2},
}


def run(*argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = asset_pack.main([str(item) for item in argv])
    return code, json.loads(out.getvalue())


class AssetPackTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        (self.root / "public/assets/characters").mkdir(parents=True)
        Image.new("RGBA", (151, 340)).save(self.root / "public/assets/characters/heroine.png")
        self.pack = self.root / "public/assets/asset-pack.json"
        self.pack.write_text(json.dumps(PACK, indent=4))
        self.spec = self.root / "art/spec.json"

    def test_register_updates_in_place_adds_new_keys_and_keeps_meta_last(self):
        code, result = run("register", self.pack, "--key", "heroine", "--url", "assets/characters/heroine.png")
        self.assertEqual((code, result["action"]), (0, "updated"))
        code, result = run("register", self.pack, "--key", "heroine_walk", "--url", "assets/characters/heroine_walk.png",
                           "--type", "spritesheet", "--frame-width", "160", "--frame-height", "340", "--section", "characters")
        self.assertEqual(result["action"], "added")
        pack = json.loads(self.pack.read_text())
        self.assertEqual(list(pack), ["characters", "audio", "meta"])
        self.assertEqual(pack["characters"]["files"][1]["frameConfig"], {"frameWidth": 160, "frameHeight": 340})
        self.assertTrue(self.pack.read_text().startswith('{\n    "characters"'))

    def test_spec_init_set_and_check(self):
        code, result = run("spec-init", "--pack", self.pack, "--root", self.root / "public", "--project", "demo", "-o", self.spec)
        self.assertEqual((code, result["count"]), (0, 1))
        spec = json.loads(self.spec.read_text())
        self.assertEqual(spec["assets"]["heroine"]["size"], {"w": 151, "h": 340})
        self.assertEqual(run("spec-set", self.spec, "heroine", "status=final", 'size={"w":"auto","h":340}')[0], 0)
        self.assertEqual(run("spec-set", self.spec, "heroine", "status=done")[0], 1)
        code, result = run("check", "--spec", self.spec, "--root", "/", "--pack", self.pack)
        self.assertEqual(code, 0, result)
        Image.new("RGB", (151, 300)).save(self.root / "public/assets/characters/heroine.png")
        code, result = run("check", "--spec", self.spec, "--root", "/", "--pack", self.pack, "heroine")
        self.assertEqual(code, 1)
        self.assertEqual(len(result["results"][0]["problems"]), 2)
        run("spec-init", "--pack", self.pack, "--root", self.root / "public", "--project", "demo", "-o", self.spec)
        self.assertEqual(json.loads(self.spec.read_text())["assets"]["heroine"]["status"], "final", "re-running keeps annotations")


if __name__ == "__main__":
    unittest.main()
