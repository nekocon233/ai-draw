import base64
import json
import shutil
import subprocess
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from PIL import Image
from comfyui.requests.local_comfyui_request import LocalComfyUIRequest
from comfyui.structures.minimax_h3 import get_minimax_h3_video_frame_count
from server.generation.contracts import GenerationParameters, ProviderInput
from server.generation.minimax_h3_ref import ANALYSIS_FALLBACK_PROGRESS, MiniMaxH3ReferenceProvider, validate_motion_references
from utils.llm import LLMServiceUnavailable
from utils.motion_prompt import motion_prompt_input_hash

VIDEO = '/uploads/reference/1/' + 'a' * 32 + '.mp4'


class Graph(dict):
    def get_node_id(self, title):
        return next(key for key, node in self.items() if node.get('_meta', {}).get('title') == title)

    def set_node_param(self, title, name, value):
        self[self.get_node_id(title)]['inputs'][name] = value


def png(width, height, color):
    output = BytesIO()
    Image.new('RGB', (width, height), color).save(output, format='PNG')
    return base64.b64encode(output.getvalue()).decode('ascii')


class MiniMaxReferenceTests(unittest.IsolatedAsyncioTestCase):
    def test_snapshot_copies_ordered_poses_and_requires_character(self):
        poses = ['pose-a', 'pose-b']
        params = GenerationParameters('move', workflow='minimax_h3_ref', reference_image='character', motion_reference_images=poses)
        poses.reverse()
        self.assertEqual(params.motion_reference_images, ('pose-a', 'pose-b'))
        validate_motion_references(params)
        for images in ([], [''] , ['pose'] * 9):
            with self.assertRaises(ValueError):
                validate_motion_references(GenerationParameters('move', reference_image='character', motion_reference_images=images))
        with self.assertRaisesRegex(ValueError, '角色'):
            validate_motion_references(GenerationParameters('move', motion_reference_images=['pose']))

    def test_a_motion_video_replaces_the_pose_images(self):
        validate_motion_references(GenerationParameters('dance', reference_image='character', motion_reference_video=VIDEO))
        with self.assertRaisesRegex(ValueError, '二选一'):
            validate_motion_references(GenerationParameters(
                'dance', reference_image='character', motion_reference_images=['pose'], motion_reference_video=VIDEO))
        for value in ('/uploads/video/1/clip.mp4', 'data:video/mp4;base64,AAAA'):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, '地址无效'):
                validate_motion_references(GenerationParameters('dance', reference_image='character', motion_reference_video=value))
        with self.assertRaisesRegex(ValueError, '角色'):
            validate_motion_references(GenerationParameters('dance', motion_reference_video=VIDEO))

    async def test_provider_sends_only_the_subject_with_the_video_and_mode_specific_prompt(self):
        async def generate(**options):
            options['finish_callback']('video')
        service = SimpleNamespace(generate_minimax_h3_ref=AsyncMock(side_effect=generate))
        params = GenerationParameters('节奏轻快', workflow='minimax_h3_ref', motion_reference_video=VIDEO,
                                      motion_prompt={'version': 1, 'input_hash': 'a' * 64, 'prompt': '先挥手后转圈'})
        request = ProviderInput(params, ('character', None, None), motion_video='/data/clip.mp4')
        await MiniMaxH3ReferenceProvider(service).generate(request)
        options = service.generate_minimax_h3_ref.call_args.kwargs
        self.assertEqual((options['images'], options['video_path'], options['canvas_image_index']), (['character'], '/data/clip.mp4', 0))
        for text in ('<Video 1>', 'attribute_transfer', '[reference generation]', 'sole visual baseline', '先挥手后转圈', '节奏轻快'):
            self.assertIn(text, options['prompt_text'])
        self.assertNotIn('<Picture 2>', options['prompt_text'])
        shot = GenerationParameters('雨夜', workflow='minimax_h3_ref', motion_reference_video=VIDEO,
                                    prompt_preset={'prompt': '参考镜头。', 'motion_reference_mode': 'shot'}).for_provider()
        await MiniMaxH3ReferenceProvider(service).generate(ProviderInput(shot, ('character', None, None), motion_video='/data/clip.mp4'))
        options = service.generate_minimax_h3_ref.call_args.kwargs
        self.assertEqual(options['canvas_image_index'], 1)
        for text in ('[video editing]', 'source video for the target video edit', 'partially_preserved', 'only defines the appearance'):
            self.assertIn(text, options['prompt_text'])
        self.assertNotIn('sole visual baseline', options['prompt_text'])

    async def test_face_swap_video_keeps_the_performer_and_outfit(self):
        async def generate(**options):
            options['finish_callback']('video')
        service = SimpleNamespace(generate_minimax_h3_ref=AsyncMock(side_effect=generate))
        params = GenerationParameters('雨夜', workflow='minimax_h3_ref', motion_reference_video=VIDEO,
                                      prompt_preset={'prompt': '换脸。', 'motion_reference_mode': 'face'}).for_provider()
        progress = Mock()
        provider = MiniMaxH3ReferenceProvider(service)
        with patch('server.generation.minimax_h3_ref.analyze_motion_video', return_value={'version': 1, 'input_hash': 'a' * 64, 'prompt': '换脸'}):
            await provider.enrich(ProviderInput(params, ('character', None, None), motion_video='/data/clip.mp4'), progress)
        progress.assert_called_once_with('正在分析参考视频的镜头、服装与动作...')
        await provider.generate(ProviderInput(params, ('character', None, None), motion_video='/data/clip.mp4'))
        options = service.generate_minimax_h3_ref.call_args.kwargs
        self.assertEqual((options['images'], options['canvas_image_index'], options['video_path']), (['character'], 1, '/data/clip.mp4'))
        for text in ('[video editing]', 'only the face and hair come from <Picture 1>', 'never change the outfit',
                     '<Picture 1> (face and hair): attribute_transfer', 'source video for the target video edit'):
            self.assertIn(text, options['prompt_text'])
        self.assertNotIn('Replace the performer of <Video 1> with <Subject 1>', options['prompt_text'])

    async def test_unavailable_vision_service_skips_the_analysis_and_still_generates(self):
        async def generate(**options):
            options['finish_callback']('video')
        service = SimpleNamespace(generate_minimax_h3_ref=AsyncMock(side_effect=generate))
        params = GenerationParameters('雨夜', workflow='minimax_h3_ref', reference_image='character', motion_reference_video=VIDEO,
                                      prompt_preset={'prompt': '换脸。', 'motion_reference_mode': 'face'})
        progress = Mock()
        provider = MiniMaxH3ReferenceProvider(service)
        request = ProviderInput(params, ('character', None, None), motion_video='/data/clip.mp4')
        with patch('server.generation.minimax_h3_ref.analyze_motion_video',
                   side_effect=LLMServiceUnavailable('503 Service Unavailable')) as analyze:
            prepared = await provider.enrich(request, progress)
        analyze.assert_called_once()
        self.assertEqual([entry.args[0] for entry in progress.call_args_list],
                         ['正在分析参考视频的镜头、服装与动作...', ANALYSIS_FALLBACK_PROGRESS])
        self.assertIsNone(prepared.motion_prompt)
        await provider.generate(ProviderInput(prepared.for_provider(), request.images, motion_video='/data/clip.mp4'))
        options = service.generate_minimax_h3_ref.call_args.kwargs
        for text in ('[video editing]', 'only the face and hair come from <Picture 1>', 'never change the outfit', '换脸。'):
            self.assertIn(text, options['prompt_text'])
        # 规则段照常发送，只有动作描述那一段为空。
        self.assertIn('approved motion description:\n\n', options['prompt_text'])

    async def test_the_face_workflow_analyses_in_face_mode_without_any_preset(self):
        provider = MiniMaxH3ReferenceProvider(SimpleNamespace(), default_mode="face")
        params = GenerationParameters('雨夜', workflow='minimax_h3_face', reference_image='character',
                                      motion_reference_video=VIDEO)
        progress = Mock()
        with patch('server.generation.minimax_h3_ref.analyze_motion_video',
                   return_value={'version': 1, 'input_hash': 'a' * 64, 'prompt': '换脸'}) as analyze:
            prepared = await provider.enrich(ProviderInput(params, ('character', None, None), motion_video='/data/clip.mp4'), progress)
        self.assertEqual(analyze.call_args.args[3], motion_prompt_input_hash('character', [], '雨夜', 'face', video=VIDEO))
        self.assertEqual(analyze.call_args.args[4], 'face')
        progress.assert_called_once_with('正在分析参考视频的镜头、服装与动作...')
        self.assertEqual(prepared.motion_prompt['prompt'], '换脸')

    async def test_other_analysis_failures_still_stop_before_sampling(self):
        params = GenerationParameters('雨夜', workflow='minimax_h3_ref', reference_image='character', motion_reference_video=VIDEO)
        provider = MiniMaxH3ReferenceProvider(SimpleNamespace())
        with patch('server.generation.minimax_h3_ref.analyze_motion_video',
                   side_effect=ValueError('动作分析未返回有效长度的提示词，请重试')):
            with self.assertRaisesRegex(RuntimeError, '未开始视频生成'):
                await provider.enrich(ProviderInput(params, ('character', None, None), motion_video='/data/clip.mp4'), Mock())

    async def test_provider_keeps_character_first_and_pose_order(self):
        async def generate(**options):
            options['finish_callback']('video')
        service = SimpleNamespace(generate_minimax_h3_ref=AsyncMock(side_effect=generate))
        params = GenerationParameters('先举剑再收势', workflow='minimax_h3_ref')
        result = await MiniMaxH3ReferenceProvider(service).generate(ProviderInput(params, ('character', None, None), motion_images=('up', 'down')))
        options = service.generate_minimax_h3_ref.call_args.kwargs
        self.assertEqual(options['images'], ['character', 'up', 'down'])
        self.assertIn('<Picture 2>, then <Picture 3>', options['prompt_text'])
        self.assertIn('先举剑再收势', options['prompt_text'])
        self.assertIn('do not transfer their gray material', options['prompt_text'])
        self.assertFalse(options['audio'])
        self.assertEqual(result.kind, 'video')
        params = GenerationParameters('先举剑再收势', workflow='minimax_h3_ref', workflow_options={'h3_audio': 'native'})
        await MiniMaxH3ReferenceProvider(service).generate(ProviderInput(params, ('character', None, None), motion_images=('up',)))
        self.assertTrue(service.generate_minimax_h3_ref.call_args.kwargs['audio'])

    async def test_request_uploads_real_images_and_removes_unused_inputs(self):
        root = Path(__file__).resolve().parents[1]
        path = root / 'configs/workflows/minimax_h3_ref_workflow_api.json'
        request = object.__new__(LocalComfyUIRequest)
        uploaded = []
        temporary_paths = []

        async def upload(path, name, upload_type):
            temporary_paths.append(path)
            uploaded.append(Path(path).read_bytes())
            return {'name': name, 'subfolder': 'poses', 'type': 'temp'}

        request._upload_overwrite_image = AsyncMock(side_effect=upload)
        request._queue_and_poll = AsyncMock(return_value='task')
        request.api = SimpleNamespace(
            get_history=Mock(return_value={'task': {'outputs': {'16': {'videos': [{'filename': 'result.mp4'}]}}}}),
            get_image=Mock(return_value=b'video-with-audio'),
        )
        images = [png(800, 1200, 'red'), png(1200, 800, 'gray'), png(600, 600, 'white')]
        for count in (3, 2, 9):
            graph = Graph(json.loads(path.read_text()))
            inputs = (images * 3)[:count]
            uploaded.clear()
            result = await request.generate_minimax_h3_ref(graph, 'motion', 42, inputs)
            self.assertTrue(result.is_success, result.error)
            self.assertEqual(uploaded, [base64.b64decode(image) for image in inputs])
            conditioning = graph['7']['inputs']
            self.assertEqual((conditioning['width'], conditioning['height']), (768, 1152))
            slots = [key for key in conditioning if key.startswith('ref_images.')]
            self.assertEqual(slots, [f'ref_images.ref_image_{i}' for i in range(count)])
            self.assertNotIn('first_frame', conditioning)
            self.assertNotIn('last_frame', conditioning)
            self.assertEqual(len([node for node in graph.values() if node['class_type'] == 'LoadImage']), count)
            # Without a motion video its loader and the conditioning link are gone.
            self.assertNotIn('ref_videos.ref_video_0', conditioning)
            self.assertFalse({'110', '111'} & set(graph))
            # Silent by default: the audio decode is dropped and the video is muxed without a track.
            self.assertNotIn('14', graph)
            self.assertNotIn('audio', graph['15']['inputs'])
        graph = Graph(json.loads(path.read_text()))
        result = await request.generate_minimax_h3_ref(graph, 'motion', 42, images[:2], audio=True)
        self.assertTrue(result.is_success, result.error)
        self.assertEqual(graph['15']['inputs']['audio'], ['14', 0])
        self.assertEqual(graph['14']['class_type'], 'VAEDecodeAudio')
        # Reference-shot mode sizes the automatic canvas from the first reference, not the portrait subject.
        graph = Graph(json.loads(path.read_text()))
        result = await request.generate_minimax_h3_ref(graph, 'motion', 42, images[:2], canvas_image_index=1)
        self.assertTrue(result.is_success, result.error)
        self.assertEqual((graph['7']['inputs']['width'], graph['7']['inputs']['height']), (1152, 768))
        with self.assertRaisesRegex(ValueError, '画幅'):
            await request.generate_minimax_h3_ref(Graph(json.loads(path.read_text())), 'motion', 42, images[:2], canvas_image_index=2)
        self.assertTrue(all(not Path(path).exists() for path in temporary_paths))


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'ffmpeg is required')
class MiniMaxReferenceVideoRequestTests(unittest.IsolatedAsyncioTestCase):
    async def test_video_is_conformed_uploaded_and_wired_as_the_first_reference_video(self):
        root = Path(__file__).resolve().parents[1]
        path = root / 'configs/workflows/minimax_h3_ref_workflow_api.json'
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        clip = Path(directory.name) / 'clip.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24', '-t', '4.5',
                        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(clip)], check=True, capture_output=True)
        request = object.__new__(LocalComfyUIRequest)
        uploads, temporary_paths = [], []

        async def upload(path, name, upload_type, content_type='image/png'):
            temporary_paths.append(path)
            uploads.append((name, content_type, Path(path).read_bytes()))
            return {'name': name, 'subfolder': 'ai_draw', 'type': 'temp'}

        request._upload_overwrite_image = AsyncMock(side_effect=upload)
        request._queue_and_poll = AsyncMock(return_value='task')
        request.api = SimpleNamespace(
            get_history=Mock(return_value={'task': {'outputs': {'16': {'videos': [{'filename': 'result.mp4'}]}}}}),
            get_image=Mock(return_value=b'video'),
        )
        subject = png(800, 1200, 'red')
        for canvas_index, canvas in ((0, (768, 1152)), (1, (1344, 768))):
            graph = Graph(json.loads(path.read_text()))
            uploads.clear()
            result = await request.generate_minimax_h3_ref(
                graph, 'motion', 42, [subject], duration=10, canvas_image_index=canvas_index, video_path=str(clip),
            )
            self.assertTrue(result.is_success, result.error)
            conditioning = graph['7']['inputs']
            self.assertEqual((conditioning['width'], conditioning['height']), canvas)
            # The clip, not the duration option, sets the length.
            self.assertEqual(conditioning['length'], get_minimax_h3_video_frame_count(108))
            self.assertEqual(conditioning['ref_videos.ref_video_0'], ['111', 0])
            self.assertEqual([key for key in conditioning if key.startswith('ref_images.')], ['ref_images.ref_image_0'])
            self.assertEqual(len([node for node in graph.values() if node['class_type'] == 'LoadImage']), 1)
            self.assertEqual(graph['111']['inputs']['video'], ['110', 0])
            self.assertTrue(graph['110']['inputs']['file'].startswith('ai_draw/') and graph['110']['inputs']['file'].endswith('.mp4 [temp]'))
            self.assertEqual([content_type for _, content_type, _ in uploads], ['image/png', 'video/mp4'])
            conformed = Path(directory.name) / 'conformed.mp4'
            conformed.write_bytes(uploads[1][2])
            frames = subprocess.run(['ffprobe', '-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries',
                                     'stream=nb_read_packets,width,height', '-of', 'csv=p=0', str(conformed)],
                                    check=True, capture_output=True, text=True).stdout.strip().split(',')
            width, height, count = map(int, frames)
            self.assertEqual(count, conditioning['length'])
            self.assertTrue(width % 32 == height % 32 == 0 and width <= 640 and height <= 384)
        self.assertTrue(all(not Path(path).exists() for path in temporary_paths))
        with self.assertRaisesRegex(ValueError, '一张主体图'):
            await request.generate_minimax_h3_ref(Graph(json.loads(path.read_text())), 'motion', 42, [subject, subject], video_path=str(clip))
