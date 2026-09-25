import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowMetadata } from '../src/types/api.ts';
import { carryReferenceImages, getWorkflowMethodKey, getWorkflowMethods, NO_PARKED_REFERENCES, rememberWorkflowMethod, resolveInputLora, resolveInputWorkflow, restoreWorkflowSelection } from '../src/utils/workflowOptions.ts';

const common = { description: '', requires_image: false, parameters: [], category: '生图' };
const qwen = { method_group: 'qwen_image_21_t2i', text_workflow: 'qwen_image_21_t2i', image_workflow: 'qwen_image_21_i2i', method: 'Qwen-Image-2.1' };
const workflows: WorkflowMetadata[] = [
  { ...common, ...qwen, key: 'qwen_image_21_t2i', label: 'Qwen', supports_multi_image: true, parameters: [{ name: 'lora_prompt', type: 'text', label: 'LoRA', default: '' }] },
  { ...common, ...qwen, key: 'qwen_image_21_i2i', label: 'Qwen', requires_image: true, supports_multi_image: true, parameters: [{ name: 'lora_prompt', type: 'text', label: 'LoRA', default: '' }] },
  { ...common, key: 'gpt_image', label: 'GPT Image', supports_multi_image: true },
  { ...common, key: 'minimax_h3_ref', label: 'MiniMax Ref', category: '图生视频', requires_image: true, output_type: 'video' },
  { ...common, key: 'minimax_h3', label: 'MiniMax', category: '图生视频', supports_optional_keyframes: true, output_type: 'video' },
];
const method = (key: string) => workflows.find(item => item.key === key);

test('one image group exposes Qwen and GPT Image with one unified Qwen option', () => {
  const images = workflows.filter(item => item.category === '生图');
  assert.deepEqual(getWorkflowMethods(images).map(item => item.key), ['qwen_image_21_t2i', 'gpt_image']);
  assert.deepEqual(getWorkflowMethods(images, 'qwen_image_21_i2i').map(item => item.key), ['qwen_image_21_i2i', 'gpt_image']);
  assert.equal(getWorkflowMethodKey('qwen_image_21_i2i', workflows), getWorkflowMethodKey('qwen_image_21_t2i', workflows));
});

test('uploading or removing references selects the matching Qwen execution workflow', () => {
  for (const original of ['qwen_image_21_t2i', 'qwen_image_21_i2i']) {
    assert.equal(resolveInputWorkflow(original, workflows, 'data:image/png;base64,reference'), 'qwen_image_21_i2i');
    assert.equal(resolveInputWorkflow(original, workflows, null), 'qwen_image_21_t2i');
  }
  assert.equal(resolveInputWorkflow('gpt_image', workflows, 'image'), 'gpt_image');
});

test('keeps the chosen LoRA and preserves an explicit no-LoRA choice in both modes', () => {
  for (const workflow of ['qwen_image_21_t2i', 'qwen_image_21_i2i']) {
    assert.equal(resolveInputLora('', workflow, workflows), '');
    assert.equal(resolveInputLora('<lora:AmeniwaQwen21Bilingual:0.65>', workflow, workflows), '<lora:AmeniwaQwen21Bilingual:0.65>');
  }
});

test('retired sessions fall back without leaking their adapters regardless of metadata loading order', () => {
  for (const retired of ['t2i', 'i2i', 'ideogram_t2i', 'ideogram_style', 'flf2v', 'i2v']) {
    const selection = restoreWorkflowSelection(retired, '<lora:retired-adapter:0.8>', []);
    assert.equal(selection.currentWorkflow, retired);
    assert.deepEqual(restoreWorkflowSelection(selection.currentWorkflow, selection.loraPrompt, workflows), { currentWorkflow: 'qwen_image_21_t2i', loraPrompt: '' });
    assert.deepEqual(restoreWorkflowSelection(retired, '<lora:retired-adapter:0.8>', workflows), { currentWorkflow: 'qwen_image_21_t2i', loraPrompt: '' });
  }
  assert.deepEqual(restoreWorkflowSelection('qwen_image_21_i2i', '<lora:AmeniwaQwen21Bilingual:0>', workflows),
    { currentWorkflow: 'qwen_image_21_i2i', loraPrompt: '<lora:AmeniwaQwen21Bilingual:0>' });
});

test('migrates legacy image preferences without overwriting a current unified choice', () => {
  assert.equal(rememberWorkflowMethod({ '图生图': 'gpt_image' }, workflows)['生图'], 'gpt_image');
  assert.equal(rememberWorkflowMethod({ '生图': 'qwen_image_21_i2i', '文生图': 't2i' }, workflows)['生图'], 'qwen_image_21_i2i');
  assert.equal(rememberWorkflowMethod({ '生图': 'removed', '图生图': 'qwen_image_21_i2i' }, workflows)['生图'], 'qwen_image_21_i2i');
  assert.equal(rememberWorkflowMethod({ '生图': 't2i', '文生图': 't2i' }, workflows)['生图'], 'qwen_image_21_t2i');
});

test('a restored session wins after metadata loads and remains remembered while using video', () => {
  const loaded = rememberWorkflowMethod({ '图生图': 'gpt_image' }, workflows);
  const restored = rememberWorkflowMethod(loaded, workflows, 'qwen_image_21_i2i');
  const video = rememberWorkflowMethod(restored, workflows, 'minimax_h3_ref');
  assert.equal(video['生图'], 'qwen_image_21_i2i');
  assert.equal(video['图生视频'], 'minimax_h3_ref');
});

test('switching between multi reference methods leaves the composer untouched', () => {
  const carried = carryReferenceImages(method('gpt_image'), ['a', 'b', 'c'], null);
  assert.deepEqual(carried.images, ['a', 'b', 'c']);
  assert.deepEqual(carried.parked, NO_PARKED_REFERENCES);
  assert.deepEqual(carryReferenceImages(method('qwen_image_21_i2i'), [null, null, null], null).images, [null, null, null]);
});

test('a method with fewer slots keeps what fits and hands the rest back on return', () => {
  const video = carryReferenceImages(method('minimax_h3_ref'), ['a', 'b', 'c'], null);
  assert.deepEqual(video.images, ['a', null, null]);
  assert.deepEqual(video.parked, { images: ['b', 'c'], endImage: null });
  const back = carryReferenceImages(method('qwen_image_21_i2i'), ['a', null, null], null, video.parked);
  assert.deepEqual(back.images, ['a', 'b', 'c']);
  assert.deepEqual(back.parked, NO_PARKED_REFERENCES);
});

test('text only methods park every reference instead of discarding them', () => {
  const text = carryReferenceImages({ ...common, key: 'text-only', label: 'Text only' }, ['a', 'b'], 'end');
  assert.deepEqual(text.images, [null, null, null]);
  assert.deepEqual(text.parked, { images: ['a', 'b'], endImage: 'end' });
  assert.deepEqual(carryReferenceImages(method('gpt_image'), [null, null, null], null, text.parked).images, ['a', 'b', null]);
});

test('the end frame only travels with methods that show one', () => {
  const frames = carryReferenceImages(method('minimax_h3'), ['a'], 'end');
  assert.deepEqual([frames.images[0], frames.endImage], ['a', 'end']);
  assert.deepEqual(carryReferenceImages(method('minimax_h3'), ['a'], 'end').endImage, 'end');
  const dropped = carryReferenceImages(method('minimax_h3_ref'), ['a'], 'end');
  assert.equal(dropped.endImage, null);
  assert.deepEqual(dropped.parked, { images: [], endImage: 'end' });
  assert.equal(carryReferenceImages(method('minimax_h3'), ['a'], null, dropped.parked).endImage, 'end');
});

test('an image re-added while away is not duplicated by the parked copy', () => {
  const parked = { images: ['a', 'b'], endImage: null };
  const carried = carryReferenceImages(method('qwen_image_21_i2i'), ['b'], null, parked);
  assert.deepEqual(carried.images, ['b', 'a', null]);
  assert.deepEqual(carried.parked, NO_PARKED_REFERENCES);
  const missing = carryReferenceImages(undefined, ['a'], 'end');
  assert.deepEqual(missing.parked, { images: ['a'], endImage: 'end' });
});

test('does not invent routes or lose a saved workflow before metadata is available', () => {
  assert.equal(resolveInputWorkflow('qwen_image_21_i2i', [], 'reference'), 'qwen_image_21_i2i');
  assert.equal(resolveInputWorkflow('qwen_image_21_t2i', workflows.filter(item => item.key !== 'qwen_image_21_i2i'), 'reference'), 'qwen_image_21_t2i');
});
