import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage } from '../src/types/models.ts';
import { findRepeatedGeneration } from '../src/utils/repeatedGeneration.ts';

const user: ChatMessage = { id: 'u', session_id: 's', type: 'user', timestamp: 1, content: 'a cat', params: {
  workflow: 'qwen_image_21_t2i', count: 16, width: 1024, height: 1024, workflowOptions: { qwen_steps: '40', qwen_fixed_seed: '' },
} };
const reply: ChatMessage = { id: 'u-reply', session_id: 's', type: 'assistant', timestamp: 2, content: '', images: ['keep.png'] };

test('the same last request reuses its reply with existing results, including after a partial stop', () => {
  assert.equal(findRepeatedGeneration([user, reply], 's', structuredClone(user)), reply);
  assert.equal(findRepeatedGeneration([user, reply], 's', { ...user, content: '  a cat  ' }), reply);
  assert.equal(findRepeatedGeneration([user, reply], 's', { ...user, params: {
    ...user.params!, loraPrompt: '', referenceImages: [], motionReferenceImages: [],
    workflowOptions: { qwen_fixed_seed: '', qwen_steps: '40' },
  } }), reply);
});

test('changed descriptions, generation settings, references, presets or sessions create new rounds', () => {
  assert.equal(findRepeatedGeneration([user, reply], 's', { ...user, content: 'a dog' }), undefined);
  for (const change of [{ count: 4 }, { width: 512 }, { workflow: 'gpt_image' }, { loraPrompt: 'new' },
    { referenceImages: ['reference.png'] }, { workflowOptions: { qwen_fixed_seed: 1 } }, { referenceImageEnd: 'end.png' },
    { motionReferenceVideo: '/uploads/reference/1/video.mp4' }]) {
    assert.equal(findRepeatedGeneration([user, reply], 's', { ...user, params: { ...user.params!, ...change } }), undefined);
  }
  assert.equal(findRepeatedGeneration([user, reply], 'other', user), undefined);
  assert.equal(findRepeatedGeneration([user, reply, { ...user, id: 'next' }], 's', user), undefined);
  assert.equal(findRepeatedGeneration([user, { ...reply, id: 'unrelated-reply' }], 's', user), undefined);
});

test('legacy reference slots match the same ordered inputs and preset changes remain distinct', () => {
  const earlier = { ...user, params: { ...user.params!, referenceImage: 'a', referenceImage2: 'b' } };
  assert.equal(findRepeatedGeneration([earlier, reply], 's', { ...user, params: { ...user.params!, referenceImages: ['a', 'b'] } }), reply);
  assert.equal(findRepeatedGeneration([earlier, reply], 's', { ...user, params: { ...user.params!, referenceImages: ['b', 'a'] } }), undefined);
  const preset = { id: 'p', title: 'Preset', description: '', prompt: 'one', hint: '', images: [] };
  const selected = { ...user, params: { ...user.params!, promptPreset: preset } };
  assert.equal(findRepeatedGeneration([selected, reply], 's', { ...selected, params: { ...selected.params, promptPreset: { ...preset, prompt: 'two' } } }), undefined);
});

test('automatic motion analysis does not create a duplicate bubble but an edited analysis does', () => {
  const motionPrompt = { version: 1 as const, input_hash: 'hash', prompt: 'analyzed poses' };
  const analyzed = { ...user, params: { ...user.params!, motionPrompt } };
  assert.equal(findRepeatedGeneration([analyzed, reply], 's', user), reply);
  assert.equal(findRepeatedGeneration([analyzed, reply], 's', { ...analyzed, params: { ...analyzed.params, motionPrompt: { ...motionPrompt, prompt: 'edited poses' } } }), undefined);
});
