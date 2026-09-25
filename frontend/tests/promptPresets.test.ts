import assert from 'node:assert/strict';
import test from 'node:test';
import type { PromptPreset, WorkflowMetadata } from '../src/types/api';
import { getWorkflowPresets } from '../src/utils/imageMentions.ts';
import { rememberWorkflowPromptPreset, resolveWorkflowPromptPreset, restorePromptPresetChoices } from '../src/utils/promptPresets.ts';

const base = { title: '预设', description: '', hint: '', prompt: '默认要求。', output_type: 'video' as const, images: [] };
const transition: PromptPreset = { ...base, id: 'video_transition', workflow_ids: ['minimax_h3'],
  images: [{ label: '首帧', role: '', slot: 1 }, { label: '尾帧', role: '', slot: 'end' }] };
const natural: PromptPreset = { ...base, id: 'video_motion', workflow_ids: ['minimax_h3'] };
const fixed: PromptPreset = { ...base, id: 'video_fixed_camera', workflow_ids: ['minimax_h3_ref'], requires_motion_reference: true };
const presets = [natural, transition, fixed];
const frames: WorkflowMetadata = { key: 'minimax_h3', label: 'MiniMax H3 · 首尾帧', description: '',
  parameters: [], output_type: 'video', requires_image: false, supports_optional_keyframes: true, default_prompt_preset_id: transition.id };
const motion: WorkflowMetadata = { ...frames, key: 'minimax_h3_ref', supports_optional_keyframes: false,
  requires_image: true, supports_motion_reference: true, default_prompt_preset_id: fixed.id };

test('menus show only supported presets in the declared workflow', () => {
  assert.deepEqual(getWorkflowPresets(presets, frames).map(p => p.id), [natural.id, transition.id]);
  assert.deepEqual(getWorkflowPresets(presets, motion).map(p => p.id), [fixed.id]);
  for (const key of ['i2v', 'flf2v', 'gpt_image']) {
    assert.deepEqual(getWorkflowPresets(presets, { ...frames, key }), []);
  }
  assert.deepEqual(getWorkflowPresets(presets, undefined), []);
  assert.deepEqual(getWorkflowPresets([transition], { ...frames, supports_optional_keyframes: false }), []);
});

test('first use selects independent H3 defaults and mode changes restore each choice', () => {
  const first = resolveWorkflowPromptPreset(frames, presets, {});
  assert.equal(first.promptPreset, transition);
  const next = resolveWorkflowPromptPreset(motion, presets, first.promptPresetChoices, first.promptPreset);
  assert.equal(next.promptPreset, fixed);
  assert.deepEqual(next.promptPresetChoices, { minimax_h3: transition, minimax_h3_ref: fixed });
  assert.equal(resolveWorkflowPromptPreset(frames, presets, next.promptPresetChoices, fixed).promptPreset, transition);
  assert.deepEqual(first.promptPresetChoices, { minimax_h3: transition });
});

test('manual selection and explicit opt-out survive serialization, catalog changes and mode switches', () => {
  const choices = JSON.parse(JSON.stringify({ minimax_h3: natural, minimax_h3_ref: null }));
  assert.deepEqual(resolveWorkflowPromptPreset(frames, presets, choices, fixed).promptPreset, natural);
  const cleared = resolveWorkflowPromptPreset(motion, presets, choices, natural);
  assert.equal(cleared.promptPreset, null);
  assert.equal(cleared.promptPresetChoices, choices);
  assert.equal(resolveWorkflowPromptPreset(motion, [], choices).promptPreset, null);
});

test('a delayed catalog initializes only untouched modes and preserves a manual opt-out', () => {
  const initial = resolveWorkflowPromptPreset(frames, [], {});
  assert.equal(initial.promptPreset, null);
  assert.deepEqual(initial.promptPresetChoices, {});
  assert.equal(resolveWorkflowPromptPreset(frames, presets, initial.promptPresetChoices).promptPreset, transition);
  assert.equal(resolveWorkflowPromptPreset(frames, presets, { minimax_h3: null }).promptPreset, null);
});

test('saved snapshots keep their original text and pre-migration selections are restored', () => {
  const legacy = { ...transition, prompt: '以前保存的要求。', workflow_ids: undefined };
  const choices = restorePromptPresetChoices(frames.key, legacy, null);
  assert.equal(resolveWorkflowPromptPreset(frames, presets, choices).promptPreset, legacy);
  assert.deepEqual(restorePromptPresetChoices(motion.key, null, choices), choices);
  assert.deepEqual(restorePromptPresetChoices(frames.key, legacy, { minimax_h3: null }), { minimax_h3: null });
});

test('compatible image presets carry across image methods without introducing an H3 default', () => {
  const imagePreset: PromptPreset = { ...base, output_type: 'image', id: 'image', images: [] };
  const image: WorkflowMetadata = { ...frames, key: 'gpt_image', output_type: 'image', default_prompt_preset_id: undefined };
  assert.equal(resolveWorkflowPromptPreset(image, presets, {}, imagePreset).promptPreset, imagePreset);
  assert.equal(resolveWorkflowPromptPreset(image, presets, {}, fixed).promptPreset, null);
});

const finish: PromptPreset = { ...base, id: 'sketch_finish', output_type: 'image',
  prompt: '@图片1 提供姿势与构图参考。', images: [{ label: '参考图 1', role: '构图' }] };
const qwenText: WorkflowMetadata = { key: 'qwen_image_21_t2i', label: 'Qwen', description: '', parameters: [],
  requires_image: false, output_type: 'image', supports_multi_image: true, default_prompt_preset_id: finish.id,
  text_workflow: 'qwen_image_21_t2i', image_workflow: 'qwen_image_21_i2i' };
const qwenEdit: WorkflowMetadata = { ...qwenText, key: 'qwen_image_21_i2i', requires_image: true };
const gptImage: WorkflowMetadata = { ...qwenText, key: 'gpt_image', text_workflow: undefined, image_workflow: undefined };

test('image modes select the finishing preset on first use, even before a reference is added', () => {
  for (const workflow of [qwenText, qwenEdit, gptImage]) {
    assert.equal(resolveWorkflowPromptPreset(workflow, [finish], {}, fixed).promptPreset, finish);
  }
});

test('canceling the image default survives upload, reference removal, refresh and a different method', () => {
  const first = resolveWorkflowPromptPreset(qwenText, [finish], {});
  const uploaded = resolveWorkflowPromptPreset(qwenEdit, [finish], first.promptPresetChoices, first.promptPreset);
  const cancelled = rememberWorkflowPromptPreset(qwenEdit, null, uploaded.promptPresetChoices);
  const restored = JSON.parse(JSON.stringify(cancelled));
  for (const workflow of [qwenText, qwenEdit]) {
    assert.equal(resolveWorkflowPromptPreset(workflow, [finish], restored, finish).promptPreset, null);
  }
  assert.equal(resolveWorkflowPromptPreset(gptImage, [finish], restored).promptPreset, finish);
  assert.deepEqual(cancelled, { qwen_image_21_t2i: null, qwen_image_21_i2i: null });
});

test('old image choices and opt-outs apply when the sibling execution has never been initialized', () => {
  for (const [source, target] of [[qwenText, qwenEdit], [qwenEdit, qwenText]]) {
    assert.equal(resolveWorkflowPromptPreset(target, [finish], { [source.key]: null }, finish).promptPreset, null);
    const old = { ...finish, id: 'pose', prompt: '以前保存的姿势要求。' };
    assert.equal(resolveWorkflowPromptPreset(target, [], { [source.key]: old }).promptPreset, old);
    const chosen = rememberWorkflowPromptPreset(source, old, { [target.key]: finish });
    assert.equal(resolveWorkflowPromptPreset(target, [finish], chosen).promptPreset, old);
  }
});
