import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/prepare_qwen_image_21_bilingual.py'
spec = importlib.util.spec_from_file_location('prepare_qwen_bilingual', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

CHINESE = '一个黑色双马尾的女孩，穿着白色衬衫和蓝色裙子，双手放在身前，背景为纯白色。'


class BilingualDatasetTests(unittest.TestCase):
    def fixture(self, root):
        source = root / 'original'
        source.mkdir()
        hashes = {}
        for name in ('train.jpg', 'holdout.jpg'):
            for filename, content in ((name, b'original-image-' + name.encode()),
                                      (name.replace('.jpg', '.txt'), b'1girl, solo, white_background\n')):
                (source / filename).write_bytes(content)
                hashes[filename] = hashlib.sha256(content).hexdigest()
        split = root / 'split.json'
        split.write_text(json.dumps({'source': str(source), 'seed': 20260921,
                                    'train': ['train.jpg'], 'validation': ['holdout.jpg'], 'sha256': hashes}))
        return source, split, hashes

    def test_preserves_originals_split_and_english_then_chinese_and_resumes_without_calls(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, split, hashes = self.fixture(root)
            calls = []
            def describe(path, english):
                calls.append(path.name)
                return CHINESE
            destination = root / 'bilingual'
            result = module.prepare(source, split, destination, describe, model_name='test', workers=1)
            self.assertEqual(set(calls), {'train.jpg', 'holdout.jpg'})
            self.assertEqual(result['train'], ['train.jpg'])
            self.assertFalse((destination / 'train/holdout.jpg').exists())
            self.assertEqual((destination / 'train/train.txt').read_text(),
                             '1girl, solo, white_background\n\n' + CHINESE + '\n')
            self.assertEqual({name: module.digest(source / name) for name in hashes}, hashes)
            module.prepare(source, split, destination,
                           lambda *_: self.fail('A completed caption must not be requested again'), model_name='test')

    def test_rejects_changed_source_before_creating_destination(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, split, _ = self.fixture(root)
            (source / 'train.txt').write_text('user changed this')
            with self.assertRaisesRegex(ValueError, 'Source changed'):
                module.prepare(source, split, root / 'bilingual', lambda *_: CHINESE, model_name='test')
            self.assertFalse((root / 'bilingual').exists())

    def test_refuses_overwriting_edited_bilingual_caption(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, split, _ = self.fixture(root)
            destination = root / 'bilingual'
            module.prepare(source, split, destination, lambda *_: CHINESE, model_name='test')
            path = destination / 'train/train.txt'
            path.write_text('manual edit')
            with self.assertRaisesRegex(ValueError, 'caption changed'):
                module.prepare(source, split, destination, lambda *_: CHINESE, model_name='test')
            self.assertEqual(path.read_text(), 'manual edit')
