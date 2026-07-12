import unittest
from unittest.mock import patch

from PIL import Image

from utils.video_frames import (
    BIREFNET_INPUT_SIZE,
    BackgroundRemovalOptions,
    _clean_toonout_state_dict,
    apply_background_removal,
)


class BackgroundRemovalTests(unittest.TestCase):
    def test_toonout_checkpoint_prefixes_are_removed(self):
        state_dict = {
            'module._orig_mod.decoder.weight': 1,
            'module.encoder.weight': 2,
            'head.weight': 3,
        }

        self.assertEqual(_clean_toonout_state_dict(state_dict), {
            'decoder.weight': 1,
            'encoder.weight': 2,
            'head.weight': 3,
        })

    @patch('utils.video_frames.remove_backgrounds_by_birefnet')
    def test_birefnet_uses_fixed_input_size_and_preserves_source_alpha(self, remove_mock):
        source = Image.new('RGBA', (1, 1), (10, 20, 30, 128))
        remove_mock.return_value = [Image.new('RGBA', (1, 1), (10, 20, 30, 128))]

        [result] = apply_background_removal(
            [source],
            BackgroundRemovalOptions(mode='birefnet', birefnet_image_size=2048),
        )

        self.assertEqual(result.getpixel((0, 0)), (10, 20, 30, 64))
        self.assertEqual(remove_mock.call_args.kwargs['image_size'], BIREFNET_INPUT_SIZE)

    def test_none_mode_keeps_existing_alpha_unchanged(self):
        source = Image.new('RGBA', (1, 1), (10, 20, 30, 128))

        [result] = apply_background_removal(
            [source],
            BackgroundRemovalOptions(mode='none'),
        )

        self.assertEqual(result.getpixel((0, 0)), (10, 20, 30, 128))


if __name__ == '__main__':
    unittest.main()
