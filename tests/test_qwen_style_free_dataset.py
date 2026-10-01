import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/prepare_qwen_image_21_style_free.py'
spec = importlib.util.spec_from_file_location('prepare_qwen_style_free', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

CHINESE = '一名黑色短发的女孩站在红色背景前，穿着白色连帽卫衣和灰色短裙，一只手比出剪刀手，面向观者微笑。'
TAGS = {
    'main.jpg': '1girl, black_hair, flat_color, red_background, outline',
    'minor.jpg': '1girl, blonde_hair, limited_palette, simple_background',
    'holdout.jpg': '1girl, black_hair, no_nose',
}


class StyleFreeDatasetTests(unittest.TestCase):
    def fixture(self, root):
        source = root / 'original'
        source.mkdir()
        hashes = {}
        for name, tags in TAGS.items():
            for filename, content in ((name, b'image-' + name.encode()),
                                      (name.replace('.jpg', '.txt'), tags.encode() + b'\n')):
                (source / filename).write_bytes(content)
                hashes[filename] = hashlib.sha256(content).hexdigest()
        split = root / 'split.json'
        split.write_text(json.dumps({'source': str(source), 'seed': 20260921, 'train': ['main.jpg', 'minor.jpg'],
                                     'validation': ['holdout.jpg'], 'sha256': hashes}))
        masks = root / 'masks'
        masks.mkdir()
        (masks / 'main.png').write_bytes(b'mask-main')
        return source, split, masks

    def test_strips_style_tags_groups_copies_masks_and_resumes_without_calls(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, split, masks = self.fixture(root)
            prompts = {}

            def describe(path, english):
                prompts[path.name] = english
                return CHINESE

            destination = root / 'style_free'
            result = module.prepare(source, split, destination, describe, model_name='test',
                                    group_tag='black_hair', masks=masks, workers=1)
            self.assertEqual(prompts['main.jpg'], '1girl, black_hair, red_background')
            self.assertEqual(prompts['minor.jpg'], '1girl, blonde_hair, simple_background')
            self.assertEqual((destination / 'train_main/main.txt').read_text(),
                             '1girl, black_hair, red_background\n\n' + CHINESE + '\n')
            self.assertTrue((destination / 'train_minor/minor.jpg').is_file())
            self.assertTrue((destination / 'validation/holdout.jpg').is_file())
            self.assertFalse((destination / 'train_main/holdout.jpg').exists())
            self.assertEqual((destination / 'masks/main.png').read_bytes(), b'mask-main')
            self.assertFalse((destination / 'masks/minor.png').exists())
            self.assertEqual(result['folders'], {'train_main': 1, 'train_minor': 1, 'validation': 1})
            self.assertEqual(set(result['mask_sha256']), {'main.jpg'})
            module.prepare(source, split, destination,
                           lambda *_: self.fail('A completed caption must not be requested again'),
                           model_name='test', group_tag='black_hair', masks=masks)

    def test_rendering_words_are_retried_and_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, split, _ = self.fixture(root)
            replies = {'main.jpg': ['人物以粗黑轮廓和大块色块勾勒。' + CHINESE, CHINESE],
                       'minor.jpg': [CHINESE], 'holdout.jpg': [CHINESE]}
            original_sleep = module.time.sleep
            module.time.sleep = lambda _seconds: None
            try:
                destination = root / 'style_free'
                module.prepare(source, split, destination, lambda path, _english: replies[path.name].pop(0),
                               model_name='test', group_tag='black_hair', workers=1)
            finally:
                module.time.sleep = original_sleep
            self.assertEqual(replies, {'main.jpg': [], 'minor.jpg': [], 'holdout.jpg': []})
            self.assertTrue((destination / 'train_main/main.txt').read_text().endswith(CHINESE + '\n'))
        with self.assertRaisesRegex(ValueError, 'describes the rendering: 平涂'):
            module.chinese_caption('画面采用平涂，' + CHINESE)

    def test_rejects_changed_source_before_creating_destination(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, split, _ = self.fixture(root)
            (source / 'minor.txt').write_text('user changed this')
            with self.assertRaisesRegex(ValueError, 'Source changed'):
                module.prepare(source, split, root / 'style_free', lambda *_: CHINESE,
                               model_name='test', group_tag='black_hair')
            self.assertFalse((root / 'style_free').exists())

    def test_refuses_to_overwrite_a_different_preparation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, split, masks = self.fixture(root)
            destination = root / 'style_free'
            module.prepare(source, split, destination, lambda *_: CHINESE, model_name='test',
                           group_tag='black_hair', masks=masks, workers=1)
            with self.assertRaisesRegex(ValueError, 'refusing to overwrite'):
                module.prepare(source, split, destination, lambda *_: CHINESE, model_name='test',
                               group_tag='blonde_hair', masks=masks, workers=1)


if __name__ == '__main__':
    unittest.main()
