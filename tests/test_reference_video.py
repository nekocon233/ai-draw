"""Motion reference videos: untrusted uploads, stored clips and per-generation conforming."""
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from utils.reference_video import (
    MOTION_VIDEO_FPS, ReferenceVideoError, conform_reference_video, fit_motion_video_size, motion_video_owner,
    normalize_motion_video, probe_reference_video, resolve_reference_video, sample_reference_frames, sniff_container,
)

HAS_FFMPEG = bool(shutil.which('ffmpeg') and shutil.which('ffprobe'))


def make_clip(path, seconds, size='320x240', rate=30, *extra, audio=False):
    command = ['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'testsrc=size={size}:rate={rate}']
    if audio:
        command += ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-c:a', 'aac', '-shortest']
    command += ['-t', str(seconds), *extra, str(path)]
    subprocess.run(command, check=True, capture_output=True)
    return path


class MotionVideoPathTests(unittest.TestCase):
    def test_only_the_stored_form_is_accepted(self):
        name = 'a' * 32
        self.assertEqual(motion_video_owner(f'/uploads/reference/12/{name}.mp4'), 12)
        for value in (f'/uploads/video/12/{name}.mp4', f'/uploads/reference/12/{name}.mov', f'uploads/reference/12/{name}.mp4',
                      f'/uploads/reference/12/../{name}.mp4', 'data:video/mp4;base64,AAAA', None, 42):
            self.assertIsNone(motion_video_owner(value), value)

    def test_resolution_stays_inside_the_upload_directory(self):
        with tempfile.TemporaryDirectory() as root:
            name = 'b' * 32
            clip = Path(root) / 'reference' / '3' / f'{name}.mp4'
            clip.parent.mkdir(parents=True)
            clip.write_bytes(b'clip')
            self.assertEqual(resolve_reference_video(f'/uploads/reference/3/{name}.mp4', root), clip.resolve())
            with self.assertRaisesRegex(ValueError, '不存在'):
                resolve_reference_video(f'/uploads/reference/3/{"c" * 32}.mp4', root)
            with self.assertRaisesRegex(ValueError, '无效'):
                resolve_reference_video('/uploads/reference/3/../../etc/passwd', root)

    def test_stored_size_only_shrinks_to_the_h3_reference_canvas(self):
        self.assertEqual(fit_motion_video_size(1920, 1080), (1354, 760))
        self.assertEqual(fit_motion_video_size(1080, 1920), (760, 1354))
        self.assertEqual(fit_motion_video_size(640, 360), (640, 360))
        width, height = fit_motion_video_size(3840, 1600)
        self.assertTrue(width % 2 == height % 2 == 0 and width * height <= 768 * 1344)


@unittest.skipUnless(HAS_FFMPEG, 'ffmpeg is required')
class ReferenceVideoProcessingTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)

    def test_playlists_scripts_and_images_are_rejected_before_ffmpeg(self):
        (self.root / 'concat.mp4').write_text("ffconcat version 1.0\nfile '/etc/passwd'\n")
        (self.root / 'list.mp4').write_text('#EXTM3U\n#EXTINF:10,\nhttp://example.com/a.ts\n')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red:size=8x8', '-frames:v', '1',
                        str(self.root / 'image.png')], check=True, capture_output=True)
        (self.root / 'image.png').rename(self.root / 'image.mp4')
        for name in ('concat.mp4', 'list.mp4', 'image.mp4'):
            with self.subTest(name=name), self.assertRaisesRegex(ReferenceVideoError, 'MP4、MOV 或 WebM'):
                sniff_container(self.root / name)

    def test_upload_becomes_silent_constant_rate_h264_trimmed_to_the_limit(self):
        source = make_clip(self.root / 'dance.mp4', 3, '640x360', 30, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', audio=True)
        original, stored = normalize_motion_video(source, self.root / 'stored', 2.5)
        self.assertEqual((original.width, original.height, original.frames), (640, 360, 90))
        self.assertEqual((stored.width, stored.height), (640, 360))
        self.assertAlmostEqual(stored.duration, 2.5, delta=0.05)
        self.assertEqual(stored.frames, round(2.5 * MOTION_VIDEO_FPS))
        streams = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'csv=p=0',
                                  str(self.root / 'stored')], check=True, capture_output=True, text=True).stdout.split()
        self.assertEqual(streams, ['h264,video'])

    def test_rotation_and_webm_are_normalized_and_short_clips_rejected(self):
        source = make_clip(self.root / 'phone.mp4', 2.5, '640x360', 30, '-c:v', 'libx264', '-pix_fmt', 'yuv420p')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-display_rotation', '90', '-i', str(source), '-c', 'copy',
                        str(self.root / 'rotated.mp4')], check=True, capture_output=True)
        self.assertEqual((probe_reference_video(self.root / 'rotated.mp4').width,
                          probe_reference_video(self.root / 'rotated.mp4').height), (360, 640))
        _, stored = normalize_motion_video(self.root / 'rotated.mp4', self.root / 'portrait', 15)
        self.assertEqual((stored.width, stored.height), (360, 640))
        webm = make_clip(self.root / 'clip.webm', 2.2, '1920x1080', 25, '-c:v', 'libvpx-vp9', '-b:v', '500k')
        self.assertEqual(sniff_container(webm), 'matroska')
        _, stored = normalize_motion_video(webm, self.root / 'landscape', 15)
        self.assertEqual((stored.width, stored.height), (1354, 760))
        short = make_clip(self.root / 'short.mp4', 1.5, '320x240', 24, '-c:v', 'libx264', '-pix_fmt', 'yuv420p')
        with self.assertRaisesRegex(ReferenceVideoError, '至少需要 2 秒'):
            normalize_motion_video(short, self.root / 'never', 15)

    def test_conform_cuts_or_holds_frames_at_the_planned_size(self):
        source = make_clip(self.root / 'clip.mp4', 3, '640x360', 24, '-c:v', 'libx264', '-pix_fmt', 'yuv420p')
        for frames in (107, 39):
            target = self.root / f'conformed-{frames}.mp4'
            conform_reference_video(source, target, 448, 256, frames)
            info = probe_reference_video(target)
            self.assertEqual((info.width, info.height, info.frames), (448, 256, frames))

    def test_analysis_frames_cover_the_clip_in_order(self):
        source = make_clip(self.root / 'clip.mp4', 3, '640x360', 24, '-c:v', 'libx264', '-pix_fmt', 'yuv420p')
        frames = sample_reference_frames(source, 8)
        self.assertEqual(len(frames), 8)
        moments = [moment for moment, _ in frames]
        self.assertEqual(moments, sorted(moments))
        self.assertEqual(moments[0], 0)
        self.assertAlmostEqual(moments[-1], 71 / 24)
        self.assertTrue(all(image for _, image in frames))


@unittest.skipUnless(HAS_FFMPEG, 'ffmpeg is required')
class MotionVideoUploadTests(unittest.TestCase):
    def setUp(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import StaticPool

        from server.ai_draw_service import get_ai_draw_service
        from server.api.media import router
        from server.auth import get_current_user
        from server.database import Base, get_db

        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.addCleanup(engine.dispose)
        sessions = sessionmaker(bind=engine)

        def database():
            with sessions() as db:
                yield db

        metadata = {
            'minimax_h3_ref': {'label': '动作参考', 'supports_motion_reference_video': True, 'max_motion_reference_video_seconds': 2.5},
            'minimax_h3': {'label': '首尾帧'},
        }

        def describe(workflow):
            if workflow not in metadata:
                raise ValueError(f'未知工作流: {workflow}')
            return metadata[workflow]

        deleted = []
        storage = SimpleNamespace(reference_dir=self.root / 'reference', delete_file=deleted.append)
        self.deleted = deleted
        for target in ('server.api.media.get_file_storage', 'utils.media_file_references.get_file_storage'):
            patcher = patch(target, return_value=storage)
            patcher.start()
            self.addCleanup(patcher.stop)
        app = FastAPI()
        app.include_router(router, prefix='/api')
        app.dependency_overrides[get_db] = database
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=7)
        app.dependency_overrides[get_ai_draw_service] = lambda: SimpleNamespace(catalog=SimpleNamespace(metadata=describe))
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def upload(self, path, **data):
        with open(path, 'rb') as file:
            return self.client.post('/api/media/upload-motion-video', files={'file': (Path(path).name, file, 'video/mp4')}, data=data)

    def test_upload_stores_the_trimmed_clip_for_its_owner(self):
        source = make_clip(self.root / 'dance.mp4', 3, '640x360', 30, '-c:v', 'libx264', '-pix_fmt', 'yuv420p')
        response = self.upload(source)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(motion_video_owner(body['url']), 7)
        stored = self.root / body['url'].removeprefix('/uploads/')
        self.assertTrue(stored.is_file())
        self.assertTrue(body['trimmed'])
        self.assertAlmostEqual(body['duration'], 2.5, delta=0.05)
        self.assertAlmostEqual(body['source_duration'], 3, delta=0.05)
        self.assertEqual((body['width'], body['height'], body['frames']), (640, 360, 60))
        self.assertEqual(sorted(path.name for path in stored.parent.iterdir()), [stored.name])

    def test_unsupported_workflows_and_non_videos_are_rejected_without_leftovers(self):
        source = make_clip(self.root / 'dance.mp4', 3, '320x240', 24, '-c:v', 'libx264', '-pix_fmt', 'yuv420p')
        self.assertEqual(self.upload(source, workflow='minimax_h3').status_code, 400)
        self.assertEqual(self.upload(source, workflow='unknown').status_code, 400)
        fake = self.root / 'fake.mp4'
        fake.write_text('#EXTM3U\n')
        response = self.upload(fake)
        self.assertEqual(response.status_code, 400)
        self.assertIn('MP4、MOV 或 WebM', response.json()['detail'])
        user_dir = self.root / 'reference' / '7'
        self.assertEqual(list(user_dir.iterdir()) if user_dir.exists() else [], [])

    def test_oversized_uploads_stop_at_the_limit(self):
        source = make_clip(self.root / 'dance.mp4', 2.5, '320x240', 24, '-c:v', 'libx264', '-pix_fmt', 'yuv420p')
        with patch('server.api.media.MOTION_VIDEO_MAX_UPLOAD_BYTES', 1024):
            response = self.upload(source)
        self.assertEqual(response.status_code, 413)
        self.assertEqual(list((self.root / 'reference' / '7').iterdir()), [])

    def test_old_unreferenced_clips_are_swept_on_upload(self):
        import os
        import time
        user_dir = self.root / 'reference' / '7'
        user_dir.mkdir(parents=True)
        stale, fresh, image = user_dir / f'{"d" * 32}.mp4', user_dir / f'{"e" * 32}.mp4', user_dir / 'pose.png'
        for path in (stale, fresh, image):
            path.write_bytes(b'x')
        old = time.time() - 2 * 24 * 3600
        os.utime(stale, (old, old))
        os.utime(image, (old, old))
        source = make_clip(self.root / 'dance.mp4', 2.5, '320x240', 24, '-c:v', 'libx264', '-pix_fmt', 'yuv420p')
        self.assertEqual(self.upload(source).status_code, 200)
        self.assertEqual(self.deleted, [f'reference/7/{stale.name}'])
