import importlib.util
from pathlib import Path
import unittest

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]


def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / (name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


dataset = module('prepare_dark_gothic_dataset')
captions = module('caption_dark_gothic_dataset')


class DarkGothicDatasetTests(unittest.TestCase):
    def test_padding_preserves_tall_weapon_and_feet_and_has_exact_background(self):
        image = Image.new('RGBA', (240, 500))
        draw = ImageDraw.Draw(image)
        draw.rectangle((100, 160, 180, 499), fill=(160, 30, 20, 255))
        draw.line((10, 0, 100, 320), fill=(0, 0, 255, 255), width=5)
        fitted = dataset.fitted_image(image, (238, 238, 238))
        self.assertEqual(fitted.mode, 'RGB')
        self.assertEqual(tuple(side % 64 for side in fitted.size), (0, 0))
        self.assertEqual(fitted.getpixel((0, 0)), (238, 238, 238))
        channels = iter(fitted.tobytes())
        pixels = list(zip(channels, channels, channels))
        self.assertTrue(any(b > 200 and r < 50 for r, g, b in pixels))
        self.assertTrue(any(r > 120 and g < 60 for r, g, b in pixels))
        with self.assertRaisesRegex(ValueError, 'empty_pose'):
            dataset.fitted_image(Image.new('RGBA', (100, 100)))

    def test_all_palettes_and_poses_stay_in_one_split(self):
        records = [{'id': f'{source}-{family}-{pose}', 'family': f'{source}/{family}'}
                   for source in ('base', 'mod') for family in range(15) for pose in range(5)]
        split = dataset.grouped_split(records)
        self.assertEqual(split, dataset.grouped_split(list(reversed(records))))
        for source in ('base', 'mod'):
            for family in range(15):
                self.assertEqual(len({split[f'{source}-{family}-{pose}'] for pose in range(5)}), 1)
        self.assertEqual(set(split.values()), {'train', 'validation'})

    def test_style_terms_rejected_in_both_languages_but_content_kept(self):
        caption = {'english': 'A woman in black armor holds a sword, full body on a white background.',
                   'chinese': '一名短发女性身穿黑色铠甲，双手握着一把长剑，侧身站立在白色背景前，头部到双脚完整可见。',
                   'gender': 'female', 'keep': True, 'reason': 'ok'}
        self.assertEqual(captions.validate(caption), caption)
        for language, text in [('english', 'Gothic anime sprite. '), ('chinese', '粗黑轮廓线和大块阴影。')]:
            with self.assertRaises(ValueError):
                captions.validate({**caption, language: text + caption[language]})
        with self.assertRaises(ValueError):
            captions.validate({**caption, 'keep': 'true'})


if __name__ == '__main__':
    unittest.main()
