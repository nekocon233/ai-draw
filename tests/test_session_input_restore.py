"""Legacy input recovery is read-only and must respect saved blanks and input types."""
import unittest
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from server.api.session import get_session_config
from server.database import Base
from server.models import ChatMessage, ChatSession, User


class SessionInputRestoreTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://')
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine, expire_on_commit=False)()
        self.addCleanup(self.db.close)
        self.db.add_all([User(id=1, username='owner', password_hash='test'), User(id=2, username='other', password_hash='test')])
        self.session = ChatSession(session_id='old', user_id=1)
        self.db.add(self.session)
        self.db.flush()
        self.preset = {'id': 'saved-preset', 'prompt': 'Historical instruction。', 'title': 'Old preset'}
        self.source = ChatMessage(session_id='old', user_id=1, message_id='last-user', type='user', content='last sent description',
            workflow='qwen_image_21_t2i', count=4, strength=0.6, lora_prompt='saved-style', width=768, height=512, use_original_size=False,
            reference_images=['/uploads/reference/1/a.png', None, '/uploads/reference/1/c.png'],
            workflow_options={'qwen_fixed_seed': 123}, prompt_preset=self.preset)
        self.db.add(self.source)
        self.db.commit()
        self.owner = SimpleNamespace(id=1)
        metadata = {
            'qwen_image_21_t2i': {'output_type': 'image', 'method_group': 'qwen'},
            'qwen_image_21_i2i': {'output_type': 'image', 'method_group': 'qwen'},
            'gpt_image': {'output_type': 'image'},
            'minimax_h3': {'output_type': 'video'},
        }
        config = patch('utils.config_loader.get_config', return_value=SimpleNamespace(workflow_defaults=SimpleNamespace(workflow_metadata=metadata)))
        config.start()
        self.addCleanup(config.stop)

    def read(self):
        return get_session_config('old', self.owner, self.db)

    def test_missing_composer_uses_last_sent_input_without_writing_the_database(self):
        result = self.read()
        self.assertEqual(result['prompt'], self.source.content)
        self.assertEqual(result['workflow'], self.source.workflow)
        self.assertEqual(result['reference_images'], self.source.reference_images)
        self.assertEqual((result['width'], result['height'], result['count']), (768, 512, 4))
        self.assertEqual(result['workflow_options'], {'qwen_fixed_seed': 123})
        self.assertEqual(result['prompt_preset'], self.preset)
        self.assertFalse(self.db.dirty)
        self.db.expire_all()
        self.assertIsNone(self.session.config_prompt)
        self.assertIsNone(self.session.config_workflow)

    def test_saved_unsent_draft_and_explicit_blank_both_override_history(self):
        for text in ('unsent changes', ''):
            self.session.config_prompt = text
            self.session.config_reference_images = []
            self.session.config_count = 16
            self.session.config_prompt_preset_choices = {'qwen_image_21_t2i': None}
            self.db.commit()
            result = self.read()
            self.assertEqual(result['prompt'], text)
            self.assertEqual(result['reference_images'], [])
            self.assertIsNone(result['prompt_preset'])
            self.assertEqual(result['count'], 16)

    def test_active_draft_mirror_precedes_history_and_keeps_other_type_and_parked_images(self):
        self.session.config_workflow = 'qwen_image_21_t2i'
        self.session.config_input_drafts = {
            'image': {'prompt': 'mirrored unsent', 'reference_images': ['draft.png'], 'parked_images': ['parked.png']},
            'video': {'prompt': 'video draft', 'motion_reference_images': ['pose.png']},
        }
        self.db.commit()
        original = deepcopy(self.session.config_input_drafts)
        result = self.read()
        self.assertEqual(result['prompt'], 'mirrored unsent')
        self.assertEqual(result['reference_images'], ['draft.png'])
        self.assertEqual(result['input_drafts'], original)
        self.assertEqual(self.session.config_input_drafts, original)

    def test_empty_mirror_and_legacy_reference_slots_are_respected(self):
        self.session.config_workflow = 'qwen_image_21_t2i'
        self.session.config_input_drafts = {'image': {'prompt': '', 'reference_image': 'legacy.png'}}
        self.db.commit()
        result = self.read()
        self.assertEqual(result['prompt'], '')
        self.assertEqual(result['reference_images'], ['legacy.png', None, None])

    def test_fallback_fills_only_missing_settings_and_does_not_restore_removed_references_or_presets(self):
        self.session.config_workflow = 'qwen_image_21_t2i'
        self.session.config_count = 16
        self.session.config_reference_images = []
        self.session.config_prompt_preset_choices = {'qwen_image_21_t2i': None}
        self.db.commit()
        result = self.read()
        self.assertEqual(result['prompt'], self.source.content)
        self.assertEqual(result['count'], 16)
        self.assertEqual(result['reference_images'], [])
        self.assertIsNone(result['reference_image'])
        self.assertIsNone(result['prompt_preset'])

    def test_latest_user_message_is_used_even_when_it_has_only_a_preset(self):
        self.db.add(ChatMessage(session_id='old', user_id=1, message_id='last-preset', type='user', content='',
            workflow='qwen_image_21_t2i', prompt_preset=self.preset, reference_images=['new.png']))
        self.db.add(ChatMessage(session_id='old', user_id=1, message_id='assistant', type='assistant', content='not an input'))
        self.db.commit()
        result = self.read()
        self.assertEqual(result['prompt'], '')
        self.assertEqual(result['reference_images'], ['new.png'])
        self.assertEqual(result['prompt_preset'], self.preset)

    def test_image_and_video_composers_do_not_take_each_others_history(self):
        self.session.config_workflow = 'qwen_image_21_t2i'
        self.db.add(ChatMessage(session_id='old', user_id=1, message_id='latest-video', type='user', content='video only', workflow='minimax_h3'))
        self.db.commit()
        self.assertEqual(self.read()['prompt'], 'last sent description')
        self.session.config_workflow = 'minimax_h3'
        self.db.commit()
        self.assertEqual(self.read()['prompt'], 'video only')

    def test_other_users_and_sessions_cannot_supply_fallback_inputs(self):
        with self.assertRaises(HTTPException) as denied:
            get_session_config('old', SimpleNamespace(id=2), self.db)
        self.assertEqual(denied.exception.status_code, 404)
        self.db.add(ChatSession(session_id='empty', user_id=1))
        self.db.commit()
        result = get_session_config('empty', self.owner, self.db)
        self.assertIsNone(result['prompt'])
        self.assertEqual(result['reference_images'], [None, None, None])

    def test_different_methods_do_not_inherit_incompatible_loras(self):
        self.session.config_workflow = 'gpt_image'
        self.db.commit()
        result = self.read()
        self.assertEqual(result['prompt'], self.source.content)
        self.assertIsNone(result['lora_prompt'])
        self.assertIsNone(result['workflow_options'])

    def test_retired_image_methods_can_restore_each_others_last_description(self):
        self.session.config_workflow = 't2i'
        self.source.workflow = 'ideogram_style'
        self.db.commit()
        result = self.read()
        self.assertEqual(result['prompt'], 'last sent description')
        self.assertEqual(result['reference_images'], self.source.reference_images)
        self.assertIsNone(result['lora_prompt'])
        self.assertEqual(self.session.config_workflow, 't2i')
        self.assertIsNone(self.session.config_prompt)

    def test_retired_video_history_does_not_fill_an_image_composer(self):
        self.session.config_workflow = 't2i'
        self.source.workflow = 'ideogram_style'
        self.db.add(ChatMessage(session_id='old', user_id=1, message_id='retired-video', type='user', content='video only', workflow='flf2v'))
        self.db.commit()
        self.assertEqual(self.read()['prompt'], 'last sent description')
        self.session.config_workflow = 'i2v'
        self.db.commit()
        self.assertEqual(self.read()['prompt'], 'video only')
