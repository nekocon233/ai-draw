"""Agent uploads keep the exact bytes, belong to the uploader and are cleaned up when unreferenced."""
import io
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from fastapi import HTTPException
from PIL import Image

from agent_bridge_support import AgentApp, add_round, add_users, memory_database, temporary_storage
from server.agent_bridge import uploads
from server.api.generation import _validate_reference_ownership
from utils.media_file_references import user_owns_media_path

HAS_FFMPEG = bool(shutil.which('ffmpeg') and shutil.which('ffprobe'))


def encode(image, fmt, **options):
    buffer = io.BytesIO()
    image.save(buffer, format=fmt, **options)
    return buffer.getvalue()


def rgba_png():
    image = Image.new('RGBA', (40, 30), (255, 0, 0, 0))
    image.putpixel((5, 5), (10, 200, 30, 128))
    return encode(image, 'PNG')


class AgentUploadTests(unittest.TestCase):
    def setUp(self):
        self.engine, self.sessions = memory_database(self)
        add_users(self.sessions, 'one', 'two')
        self.storage = temporary_storage(self)
        self.app = AgentApp(self, self.sessions)

    def upload(self, data, name='file.bin'):
        return self.app.client.post('/api/agent/uploads', files={'file': (name, data, 'application/octet-stream')})

    def stored_path(self, url):
        return self.storage.upload_dir / url.removeprefix('/uploads/')

    def test_rgba_png_is_stored_byte_for_byte_under_the_owner(self):
        data = rgba_png()
        response = self.upload(data, 'whatever.jpg')
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertRegex(body['url'], r'^/uploads/agent/1/\d{6}/[0-9a-f]{32}\.png$')
        self.assertEqual(
            {key: body[key] for key in ('kind', 'format', 'width', 'height', 'frames', 'has_alpha', 'bytes')},
            {'kind': 'image', 'format': 'png', 'width': 40, 'height': 30, 'frames': 1, 'has_alpha': True, 'bytes': len(data)},
        )
        self.assertEqual(self.stored_path(body['url']).read_bytes(), data)
        self.assertEqual(list(self.storage.upload_dir.glob('agent/1/.*.part')), [])
        with self.sessions() as db:
            self.assertTrue(user_owns_media_path(db, 1, body['url']))
            self.assertFalse(user_owns_media_path(db, 2, body['url']))
            _validate_reference_ownership(body['url'], 1, db, '参考图')
            with self.assertRaises(HTTPException):
                _validate_reference_ownership(body['url'], 2, db, '参考图')

    def test_animation_and_other_image_formats_keep_their_frames(self):
        frames = [Image.new('RGBA', (16, 16), (index * 60, 0, 0, 255)) for index in range(3)]
        gif = encode(frames[0], 'GIF', save_all=True, append_images=frames[1:], duration=80, loop=0)
        webp = encode(frames[0], 'WEBP', save_all=True, append_images=frames[1:], duration=80, lossless=True)
        apng = encode(frames[0], 'PNG', save_all=True, append_images=frames[1:], duration=80)
        jpeg = encode(Image.new('RGB', (8, 8), 'white'), 'JPEG')
        cases = [(gif, 'gif', 3), (webp, 'webp', 3), (apng, 'png', 3), (jpeg, 'jpg', 1)]
        for data, extension, count in cases:
            with self.subTest(extension=extension):
                body = self.upload(data).json()
                self.assertTrue(body['url'].endswith(f'.{extension}'))
                self.assertEqual(body['frames'], count)
                self.assertEqual(self.stored_path(body['url']).read_bytes(), data)
        self.assertFalse(self.upload(jpeg).json()['has_alpha'])

    @unittest.skipUnless(HAS_FFMPEG, 'ffmpeg is required')
    def test_video_is_probed_and_kept(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'clip.mp4'
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=64x48:rate=12',
                            '-t', '1', '-pix_fmt', 'yuv420p', str(path)], check=True)
            data = path.read_bytes()
        body = self.upload(data, 'clip.png').json()
        self.assertEqual((body['kind'], body['format'], body['width'], body['height']), ('video', 'mp4', 64, 48))
        self.assertTrue(body['url'].endswith('.mp4'))
        self.assertGreater(body['duration'], 0.5)

    def test_garbage_empty_and_oversized_images_are_rejected(self):
        self.assertEqual(self.upload(b'#EXTM3U\nfile:///etc/passwd\n').status_code, 415)
        self.assertEqual(self.upload(b'').status_code, 400)
        self.assertEqual(self.upload(encode(Image.new('L', (9000, 2)), 'PNG')).status_code, 413)
        self.assertEqual(self.upload(encode(Image.new('RGB', (8, 8)), 'BMP')).status_code, 415)
        self.assertEqual([path for path in self.storage.upload_dir.rglob('*') if path.is_file()], [])

    def test_old_unreferenced_uploads_are_swept_and_referenced_ones_kept(self):
        old, used, recent = (self.upload(rgba_png()).json()['url'] for _ in range(3))
        add_round(self.sessions, 'session', 1, 'round', [used], create_session=True)
        week_ago = time.time() - uploads.ORPHAN_MAX_AGE_SECONDS - 60
        for url in (old, used):
            os.utime(self.stored_path(url), (week_ago, week_ago))
        partial = self.storage.upload_dir / 'agent/1/.stale.part'
        partial.write_bytes(b'x')
        os.utime(partial, (week_ago, week_ago))
        latest = self.upload(rgba_png()).json()['url']
        self.assertFalse(self.stored_path(old).exists())
        self.assertFalse(partial.exists())
        for url in (used, recent, latest):
            self.assertTrue(self.stored_path(url).exists(), url)


if __name__ == '__main__':
    unittest.main()
