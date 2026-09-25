import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowMetadata } from '../src/types/api.ts';
import { compactReferenceImages, getImageGenerationSettings, getWorkflowMethods, getWorkflowOptions, resolveInputWorkflow } from '../src/utils/workflowOptions.ts';

const base = {
  method: 'Qwen-Image-2.1', description: '', method_group: 'qwen_image_21_t2i',
  text_workflow: 'qwen_image_21_t2i', image_workflow: 'qwen_image_21_i2i',
  parameters: [
    { name: 'width', label: 'width', type: 'number' as const, default: 1024 },
    { name: 'height', label: 'height', type: 'number' as const, default: 1024 },
    { name: 'qwen_steps', label: 'steps', type: 'select' as const, default: '40', options: ['20', '25', '40', '50'] },
  ],
};
const workflows: WorkflowMetadata[] = [
  { ...base, key: 'qwen_image_21_t2i', label: 'text', requires_image: false },
  { ...base, key: 'qwen_image_21_i2i', label: 'edit', requires_image: true, supports_original_size: true },
];

test('Qwen 2.1 text and editing modes share one entry', () => {
  assert.deepEqual(getWorkflowMethods(workflows).map(w => w.key), ['qwen_image_21_t2i']);
});

test('removing the first reference keeps editing while any other image remains', () => {
  for (const original of ['qwen_image_21_t2i', 'qwen_image_21_i2i']) {
    assert.equal(resolveInputWorkflow(original, workflows, [null, 'second', 'third']), 'qwen_image_21_i2i');
    assert.equal(resolveInputWorkflow(original, workflows, [null, null, null]), 'qwen_image_21_t2i');
  }
  assert.deepEqual(compactReferenceImages([null, 'second', undefined, 'third']), ['second', 'third']);
});

test('text generation always uses explicit dimensions and ignores hidden original-size preference', () => {
  assert.deepEqual(getImageGenerationSettings(workflows[0], { width: 768, height: 1024, useOriginalSize: true }, false),
    { width: 768, height: 1024, useOriginalSize: false });
});

test('retries preserve explicit false and old records use workflow defaults', () => {
  assert.deepEqual(getImageGenerationSettings(workflows[1], { width: 512, height: 768, useOriginalSize: false }, true),
    { width: 512, height: 768, useOriginalSize: false });
  assert.deepEqual(getImageGenerationSettings(workflows[1], {}, true),
    { width: 1024, height: 1024, useOriginalSize: true });
  assert.deepEqual(getWorkflowOptions(workflows[1], {}), { qwen_steps: '40' });
});
