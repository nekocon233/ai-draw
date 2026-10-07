"""Integration regression: rotated atlas and action selection in the actual old-Spine renderer."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = Path('/opt/ai-toolkit/datasets/dark_gothic_anime_v1/tools/spine.js')
PUPPETEER = Path('/opt/tools/czn/render/node_modules/puppeteer-core')


@unittest.skipUnless(RUNTIME.exists() and PUPPETEER.exists(), 'Host-only pinned Spine/Chrome extraction environment')
class DarkGothicRendererTests(unittest.TestCase):
    def test_rotated_atlas_stays_colored_when_death_is_first_animation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'tools').mkdir()
            shutil.copy2(RUNTIME, root / 'tools/spine.js')
            image = Image.new('RGBA', (64, 32), (0, 0, 255, 255))
            ImageDraw.Draw(image).rectangle((0, 0, 31, 31), fill=(255, 0, 0, 255))
            image.save(root / 'texture.png')
            (root / 'texture.atlas').write_text('''
texture.png
size: 64,32
format: RGBA8888
filter: Linear,Linear
repeat: none
body
  rotate: true
  xy: 0, 0
  size: 32, 64
  orig: 32, 64
  offset: 0, 0
  index: -1
''')
            skeleton = {'skeleton': {'spine': '2.1.27'}, 'bones': [{'name': 'root'}],
                        'slots': [{'name': 'body', 'bone': 'root', 'attachment': 'body'}],
                        'skins': {'default': {'body': {'body': {'width': 32, 'height': 64}}}},
                        'animations': {'death': {'slots': {'body': {'color': [{'time': 0, 'color': '000000ff'}]}}},
                                       'defend': {}}}
            (root / 'skeleton.json').write_text(json.dumps(skeleton))
            (root / 'jobs.json').write_text(json.dumps([{'id': 'fixture', 'family': 'fixture', 'action': 'defend',
                                                        'texture': 'texture.png', 'atlas': 'texture.atlas',
                                                        'skeleton': 'skeleton.json', 'phase': 0.35}]))
            result = subprocess.run(['node', str(ROOT / 'scripts/render_darkest_dungeon.mjs'), str(root)],
                                    capture_output=True, text=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('"status":"ok"', result.stdout)
            with Image.open(root / 'poses/fixture.png') as actual:
                box = actual.getchannel('A').getbbox()
                self.assertEqual((box[2] - box[0], box[3] - box[1]), (32, 64))
                self.assertEqual(actual.getpixel((24, 20)), (255, 0, 0, 255))
                self.assertEqual(actual.getpixel((24, 60)), (0, 0, 255, 255))


if __name__ == '__main__':
    unittest.main()
