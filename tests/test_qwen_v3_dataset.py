import hashlib
import importlib.util
from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/prepare_qwen_image_21_v3.py'
spec = importlib.util.spec_from_file_location('prepare_qwen_v3', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

PRESET = '<image1> 是线稿草稿。保持姿势不变，将草稿重新绘制成完成度高的成品。'
CHINESE = '画面中一名黑色双马尾女孩站着，穿白色衬衫和蓝色裙子，双手放在身前，背景为纯白色。'
SHORT = '一个黑色双马尾女孩，穿白衬衫和蓝裙子，双手放在身前，白色背景。'


def encoded(size, color, kind='JPEG'):
    buffer = BytesIO()
    Image.new('RGB', size, color).save(buffer, kind)
    return buffer.getvalue()


def fake_sketch(path, method):
    with Image.open(path) as image:
        return encoded(image.size, 'white' if method == 'manga' else 'lightgray', 'PNG')


class V3DatasetTests(unittest.TestCase):
    def fixture(self, root):
        source = root / 'bilingual'
        hashes = {}
        for section, name, tags in (('train', 'train.jpg', '1girl, solo, signature'), ('validation', 'holdout.jpg', '1girl, solo')):
            folder = source / section
            folder.mkdir(parents=True)
            for filename, content in ((name, encoded((200, 250), 'navy')),
                                      (name.replace('.jpg', '.txt'), (tags + '\n\n' + CHINESE + '\n').encode())):
                (folder / filename).write_bytes(content)
                hashes[filename] = hashlib.sha256(content).hexdigest()
        (source / 'manifest.json').write_text(json.dumps({
            'seed': 20260921, 'train': ['train.jpg'], 'validation': ['holdout.jpg'], 'sha256': hashes,
        }))
        return source

    def run_prepare(self, source, destination, sketch=None, summarize=None):
        return module.prepare(
            source, destination, sketch or fake_sketch,
            summarize or (lambda name, chinese: SHORT),
            preset=PRESET, model_name='test',
        )

    def test_builds_style_free_groups_and_edit_pairs_then_resumes_without_calls(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = self.fixture(root)
            destination = root / 'v3'
            result = self.run_prepare(source, destination)
            self.assertTrue(result['complete'])
            read = lambda path: (destination / path).read_text(encoding='utf-8')
            self.assertEqual(read('t2i_long/train.txt'), CHINESE + module.SIGNATURE_NOTE + '\n')
            self.assertEqual(read('t2i_short/train.txt'), SHORT + module.SIGNATURE_NOTE + '\n')
            self.assertEqual(read('edit_manga/train.txt'), PRESET + SHORT + module.SIGNATURE_NOTE + '\n')
            self.assertEqual(read('edit_coarse/train.txt'), PRESET + '\n')
            # Target and sketch share the exact bucket size, so cached reference slots match training.
            for method, color in (('manga', (255, 255, 255)), ('coarse', (211, 211, 211))):
                with Image.open(destination / f'edit_{method}/train.png') as target, \
                        Image.open(destination / f'edit_{method}_control/train.png') as control:
                    self.assertEqual(target.size, (192, 256))
                    self.assertEqual(control.size, target.size)
                    self.assertEqual(control.getpixel((0, 0)), color)
            # Held-out images never enter a training group.
            self.assertFalse(any((destination / group / 'holdout.jpg').exists() for group in ('t2i_long', 't2i_short', 'edit_manga', 'edit_coarse')))
            self.assertEqual(read('validation/holdout.short.txt'), SHORT + '\n')
            self.assertTrue((destination / 'validation/holdout.coarse.png').is_file())
            fail = lambda *_: self.fail('Cached sketches and captions must not be requested again')
            self.run_prepare(source, destination, sketch=fail, summarize=fail)

    def test_rejects_rendering_words_in_short_captions_and_style_words_in_long_captions(self):
        for value in ('一个女孩，二次元插画风格，白色背景。', '一个女孩，粗线条平涂上色，白色背景。', '一个女孩，头发有高光，右下角有签名。'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.short_caption(value)
        self.assertEqual(module.short_caption('一个发尾渐变为绿色的女孩坐在椅子上，蓝色背景'), '一个发尾渐变为绿色的女孩坐在椅子上，蓝色背景。')
        with self.assertRaisesRegex(ValueError, 'painting style'):
            module.long_caption('x.jpg', '1girl\n\n画面中一名女孩，采用平涂画风绘制，背景为白色。')

    def test_known_caption_fix_removes_the_style_highlight_description(self):
        text = '1girl\n\n她身穿细肩带黑色连衣裙，肩部与侧腰露出，裙上有蓝紫色块。她上身前倾。'
        self.assertEqual(module.long_caption('GiFLUSJacAAoRE7.jpg', text), '她身穿细肩带黑色连衣裙，肩部与侧腰露出。她上身前倾。')

    def test_rejects_changed_source_and_foreign_destination(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = self.fixture(root)
            (source / 'train/train.txt').write_text('changed')
            with self.assertRaisesRegex(ValueError, 'Source changed'):
                self.run_prepare(source, root / 'v3')
            self.assertFalse((root / 'v3').exists())
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = self.fixture(root)
            (root / 'v3').mkdir()
            (root / 'v3/preparation.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'another preparation'):
                self.run_prepare(source, root / 'v3')

    def test_edit_sizes_are_toolkit_buckets_that_never_rescale(self):
        for width, height in ((1080, 1352), (1080, 1920), (1194, 1020), (200, 250), (4000, 1000)):
            with self.subTest(size=(width, height)):
                bucket = module.edit_size(width, height)
                self.assertTrue(all(side % 64 == 0 for side in bucket))
                self.assertLessEqual(bucket[0] * bucket[1], 1024 * 1024)
                # Feeding the bucket back in must return it unchanged.
                self.assertEqual(module.edit_size(*bucket), bucket)

    def test_edit_captions_require_the_resolved_image_reference(self):
        with self.assertRaisesRegex(ValueError, '<image1>'):
            module.edit_caption('@图片1 是线稿草稿。')


if __name__ == '__main__':
    unittest.main()
