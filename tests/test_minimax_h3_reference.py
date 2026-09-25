import base64
import json
import unittest
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from PIL import Image
from comfyui.requests.local_comfyui_request import LocalComfyUIRequest
from server.generation.contracts import GenerationParameters, ProviderInput
from server.generation.minimax_h3_ref import MiniMaxH3ReferenceProvider, validate_motion_references


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
        self.assertEqual(result.kind, 'video')

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
        self.assertTrue(all(not Path(path).exists() for path in temporary_paths))
