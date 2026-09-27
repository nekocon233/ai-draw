import asyncio
import base64
import hashlib
import json
import unittest
from dataclasses import replace
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from server.api.prompt import router
from server.ai_draw_service import get_ai_draw_service
from server.auth import get_current_user
from server.database import Base, get_db
from server.generation.contracts import GenerationParameters, ProviderInput, TaskContext
from server.generation.coordinator import GenerationCoordinator
from server.generation.events import EventPublisher
from server.generation.minimax_h3_ref import MiniMaxH3ReferenceProvider, motion_reference_prompt
from utils.motion_prompt import analyze_motion_images, current_motion_prompt, matching_motion_prompt, motion_prompt_input_hash


class MotionPromptTests(unittest.IsolatedAsyncioTestCase):
    def test_previous_policy_snapshot_is_invalidated_without_changing_its_schema(self):
        old_hash = hashlib.sha256(json.dumps([1,'character',['pose'],'extra'],separators=(',',':')).encode()).hexdigest()
        old = {'version':1,'input_hash':old_hash,'prompt':'Old analysis'}
        self.assertFalse(current_motion_prompt(old,motion_prompt_input_hash('character',['pose'],'extra')))

    def test_analysis_sees_all_images_in_order_and_preserves_raw_supplement(self):
        with patch('utils.motion_prompt.LanguageModel') as llm:
            llm.return_value.complete.return_value = '保持原图背景和镜头，动作1抬手，动作2放下。'
            signature = motion_prompt_input_hash('source', ['first', 'second'], '慢慢抬手')
            result = analyze_motion_images('source', ['first', 'second'], '慢慢抬手', signature)
            args, kwargs = llm.return_value.complete.call_args
            self.assertEqual(kwargs['images'], ['source', 'first', 'second'])
            self.assertIn('慢慢抬手', args[0])
            self.assertIn('第一张图', kwargs['system'])
            self.assertIn('不为展示动作而拉远', kwargs['system'])
            self.assertIn('不能由用户补充文字决定', kwargs['system'])
            self.assertIn('文字与图中动作冲突时，以动作参考图为准', kwargs['system'])
            self.assertTrue(current_motion_prompt(result, signature))

    async def test_cached_manual_text_reused_but_reordered_inputs_reanalyzed(self):
        params = GenerationParameters('慢慢', workflow='minimax_h3_ref', reference_image='character',
                                      motion_reference_images=['a', 'b'], prompt_preset={'prompt':'固定镜头。'})
        signature = motion_prompt_input_hash('character', ['a', 'b'], params.for_provider().prompt)
        snapshot = {'version':1, 'input_hash':signature, 'prompt':'用户修改后的动作文字'}
        params = replace(params, motion_prompt=snapshot)
        provider = MiniMaxH3ReferenceProvider(SimpleNamespace())
        progress = Mock()
        with patch('server.generation.minimax_h3_ref.analyze_motion_images', return_value={**snapshot, 'prompt':'新顺序'}) as analyze:
            cached = await provider.enrich(ProviderInput(params, ('char-bytes',None,None), motion_images=('a-bytes','b-bytes')), progress)
            self.assertEqual(cached.motion_prompt['prompt'], '用户修改后的动作文字')
            analyze.assert_not_called()
            changed = replace(params, motion_reference_images=['b', 'a'])
            await provider.enrich(ProviderInput(changed, ('char-bytes',None,None), motion_images=('b-bytes','a-bytes')), progress)
            self.assertEqual(analyze.call_args.args[:3], ('char-bytes', ('b-bytes','a-bytes'), '固定镜头。慢慢'))
            self.assertNotEqual(analyze.call_args.args[3], signature)
            progress.assert_called_once()
        self.assertIsNone(matching_motion_prompt(snapshot, 'different', ['a','b'], '慢慢', {'prompt':'固定镜头。'}))
        self.assertIsNone(matching_motion_prompt(snapshot, 'character', ['a','b'], '快速', {'prompt':'固定镜头。'}))

    def test_shot_mode_has_its_own_policy_and_keeps_pose_hashes_stable(self):
        pose = json.dumps([1,'reference-actions-primary-v1','character',['pose'],'extra'],ensure_ascii=False,separators=(',',':'))
        self.assertEqual(motion_prompt_input_hash('character',['pose'],'extra'),hashlib.sha256(pose.encode()).hexdigest())
        shot = motion_prompt_input_hash('character',['pose'],'extra','shot')
        self.assertNotEqual(shot,motion_prompt_input_hash('character',['pose'],'extra'))
        snapshot = {'version':1,'input_hash':shot,'prompt':'参考镜头'}
        self.assertEqual(matching_motion_prompt(snapshot,'character',['pose'],'',{'prompt':'extra','motion_reference_mode':'shot'}),snapshot)
        self.assertIsNone(matching_motion_prompt(snapshot,'character',['pose'],'',{'prompt':'extra'}))

    def test_shot_analysis_uses_the_subject_only_for_appearance(self):
        with patch('utils.motion_prompt.LanguageModel') as llm:
            llm.return_value.complete.return_value = '主体保持外观，参考1低机位全景，参考2推近。'
            signature = motion_prompt_input_hash('subject', ['shot-a', 'shot-b'], '雨夜街道', 'shot')
            result = analyze_motion_images('subject', ['shot-a', 'shot-b'], '雨夜街道', signature, 'shot')
            args, kwargs = llm.return_value.complete.call_args
            self.assertEqual(kwargs['images'], ['subject', 'shot-a', 'shot-b'])
            self.assertIn('第一张输入是主体图', args[0])
            self.assertIn('雨夜街道', args[0])
            self.assertIn('不沿用主体图的背景、镜头、取景、构图和姿势', kwargs['system'])
            self.assertIn('一律替换为主体', kwargs['system'])
            self.assertNotIn('唯一基准', kwargs['system'])
            self.assertTrue(current_motion_prompt(result, signature))

    async def test_shot_preset_analysis_is_bound_to_its_mode(self):
        params = GenerationParameters('雨夜', workflow='minimax_h3_ref', reference_image='subject', motion_reference_images=['a'],
                                      prompt_preset={'prompt':'参考镜头。','motion_reference_mode':'shot'})
        pose_signature = motion_prompt_input_hash('subject', ['a'], '参考镜头。雨夜')
        params = replace(params, motion_prompt={'version':1,'input_hash':pose_signature,'prompt':'固定镜头的旧分析'})
        provider = MiniMaxH3ReferenceProvider(SimpleNamespace())
        progress = Mock()
        with patch('server.generation.minimax_h3_ref.analyze_motion_images', return_value={'version':1,'input_hash':'b'*64,'prompt':'镜头'}) as analyze:
            await provider.enrich(ProviderInput(params, ('subject-bytes',None,None), motion_images=('a-bytes',)), progress)
        self.assertEqual(analyze.call_args.args[2:], ('参考镜头。雨夜', motion_prompt_input_hash('subject', ['a'], '参考镜头。雨夜', 'shot'), 'shot'))
        progress.assert_called_once_with('正在分析参考镜头与动作...')

    def test_shot_prompt_follows_reference_framing_instead_of_fixed_scene(self):
        prompt = motion_reference_prompt('雨夜街道', 2, '参考1低机位，参考2推近', 'shot')
        for text in ('only defines the appearance of <Subject 1>', 'composition anchors', 'partially_preserved',
                     'The keyframes correspond to <Picture 2>, then <Picture 3>', 'without cuts', '参考1低机位，参考2推近', '雨夜街道'):
            self.assertIn(text, prompt)
        for text in ('sole visual baseline', 'locked-off', "Begin from the character's original pose"):
            self.assertNotIn(text, prompt)
        self.assertEqual(motion_reference_prompt('x', 1, 'y'), motion_reference_prompt('x', 1, 'y', 'pose'))

    def test_fixed_constraints_survive_conflicting_camera_suggestions(self):
        prompt = motion_reference_prompt('推近镜头并更换背景', 2, '原图角色先抬手再放下')
        for text in ('sole visual baseline', 'background, objects, layout, lighting', 'crop, aspect ratio',
                     'no pan, tilt, dolly, tracking, zoom', 'Do not zoom out', 'take priority', '<Picture 2>, then <Picture 3>'):
            self.assertIn(text, prompt)
        self.assertNotIn('unless the user requests camera movement', prompt)
        self.assertIn('原图角色先抬手再放下', prompt)

    async def test_preparation_failure_or_cancel_never_starts_video_or_replaces_old_result(self):
        for cancel in (False, True):
            started = asyncio.Event()
            async def prepare(parameters, progress):
                progress('正在分析动作参考图...')
                started.set()
                if cancel:
                    await asyncio.Event().wait()
                raise RuntimeError('vision unavailable')
            engine = SimpleNamespace(validate=Mock(), prepare=prepare, generate=AsyncMock(), interrupt=AsyncMock())
            repository = SimpleNamespace(persist=Mock(return_value='persisted'), discard=Mock())
            events = []
            publisher = EventPublisher(); publisher.subscribe(events.append)
            coordinator = GenerationCoordinator(engine, repository, publisher)
            params = GenerationParameters('', workflow='test')
            context = TaskContext(1, 'task', 'test', 'session', 'message-reply')
            task = coordinator.reserve(context, params)
            runner = asyncio.create_task(coordinator.run(task, params))
            await started.wait()
            if cancel:
                await coordinator.stop(1, 'task')
            await runner
            engine.generate.assert_not_called()
            self.assertTrue(all(not call.kwargs['replace_existing'] for call in repository.persist.call_args_list))
            self.assertTrue(all(event.user_id == 1 for event in events))
            self.assertEqual(coordinator.tasks.last_task(1)['phase'], 'cancelled' if cancel else 'error')

    async def test_prepared_snapshot_persists_without_overwriting_user_description(self):
        snapshot = {'version':1,'input_hash':'a'*64,'prompt':'识别出的动作'}
        params = GenerationParameters('', workflow='test')
        async def generate(parameters, context, on_artifact, check_cancelled):
            self.assertEqual(parameters.motion_prompt, snapshot)
            on_artifact('new-video', 0, 1)
            return ['new-video']
        engine = SimpleNamespace(validate=Mock(), prepare=AsyncMock(return_value=replace(params,motion_prompt=snapshot)), generate=generate)
        repository = SimpleNamespace(persist=Mock(return_value='persisted'), discard=Mock())
        coordinator = GenerationCoordinator(engine, repository, EventPublisher())
        task = coordinator.reserve(TaskContext(1,'task','test','session','message-reply'), params)
        await coordinator.run(task, params)
        updates = repository.persist.call_args.kwargs['source_updates']
        self.assertEqual(updates['content'], '')
        self.assertEqual(updates['motion_prompt'], snapshot)
        self.assertIsNone(params.motion_prompt)


class MotionPromptAPITests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        sessions = sessionmaker(bind=self.engine)
        def database():
            with sessions() as db: yield db
        async def analyze(character, poses, description, signature, user_id, mode='pose'):
            return {'version':1,'input_hash':signature,'prompt':'保持原图，只依次改变姿势。'}
        self.service = SimpleNamespace(analyze_motion_prompt=AsyncMock(side_effect=analyze))
        app = FastAPI(); app.include_router(router,prefix='/api')
        app.dependency_overrides[get_db] = database
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
        app.dependency_overrides[get_ai_draw_service] = lambda: self.service
        self.app = app; self.client = TestClient(app)
        self.addCleanup(self.client.close); self.addCleanup(self.engine.dispose)
        data = BytesIO(); Image.new('RGB',(2,2),'red').save(data,format='PNG')
        self.image = 'data:image/png;base64,' + base64.b64encode(data.getvalue()).decode('ascii')

    def test_empty_description_supported_and_image_count_validated(self):
        body = {'reference_image':self.image,'motion_reference_images':[self.image]*8}
        response = self.client.post('/api/prompt/analyze-motion',json=body)
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['input_hash'],motion_prompt_input_hash(self.image,[self.image]*8,''))
        self.assertEqual(len(self.service.analyze_motion_prompt.call_args.args[1]),8)
        for images in ([],[self.image]*9):
            self.assertEqual(self.client.post('/api/prompt/analyze-motion',json={**body,'motion_reference_images':images}).status_code,422)

    def test_shot_mode_is_forwarded_and_bound_to_the_returned_hash(self):
        body = {'reference_image':self.image,'motion_reference_images':[self.image],'description':'雨夜','motion_reference_mode':'shot'}
        response = self.client.post('/api/prompt/analyze-motion',json=body)
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['input_hash'],motion_prompt_input_hash(self.image,[self.image],'雨夜','shot'))
        self.assertEqual(self.service.analyze_motion_prompt.call_args.args[5],'shot')
        self.assertEqual(self.client.post('/api/prompt/analyze-motion',json={**body,'motion_reference_mode':'scene'}).status_code,422)

    def test_authentication_and_foreign_image_checks_precede_vision_call(self):
        body = {'reference_image':self.image,'motion_reference_images':['/uploads/reference/2/private.png']}
        self.assertEqual(self.client.post('/api/prompt/analyze-motion',json=body).status_code,403)
        self.service.analyze_motion_prompt.assert_not_called()
        del self.app.dependency_overrides[get_current_user]
        self.assertEqual(self.client.post('/api/prompt/analyze-motion',json=body).status_code,401)

    def test_external_urls_and_invalid_images_are_rejected_without_fetching(self):
        for image in ('https://example.com/pose.png', 'not-an-image'):
            response = self.client.post('/api/prompt/analyze-motion',json={'reference_image':self.image,'motion_reference_images':[image]})
            self.assertEqual(response.status_code,400)
        self.service.analyze_motion_prompt.assert_not_called()
