import assert from 'node:assert/strict';
import test from 'node:test';

import type { WorkflowMetadata } from '../src/types/api.ts';
import { getWorkflowOptions, resolveAvailableWorkflow } from '../src/utils/workflowOptions.ts';

const metadata: WorkflowMetadata = {
  key: 'minimax_h3',
  label: 'MiniMax H3',
  description: '',
  requires_image: false,
  parameters: [
    { name: 'prompt', label: '提示词', type: 'text', default: '' },
    { name: 'h3_duration', label: '时长', type: 'select', options: ['5', '10'], default: '5' },
    { name: 'h3_aspect_ratio', label: '画幅', type: 'select', options: ['auto', '16:9'], default: 'auto' },
  ],
};

test('keeps only select options declared by the active workflow', () => {
  assert.deepEqual(
    getWorkflowOptions(metadata, {
      h3_duration: '10',
      h3_aspect_ratio: '16:9',
      unrelated_provider_option: 'ignored',
    }),
    {
      h3_duration: '10',
      h3_aspect_ratio: '16:9',
    },
  );
});

test('fills missing workflow options from metadata defaults', () => {
  assert.deepEqual(getWorkflowOptions(metadata, {}), {
    h3_duration: '5',
    h3_aspect_ratio: 'auto',
  });
});

test('replaces stale option values with metadata defaults', () => {
  assert.deepEqual(getWorkflowOptions(metadata, { h3_duration: '99' }), {
    h3_duration: '5',
    h3_aspect_ratio: 'auto',
  });
});

test('restores retired workflows to an available default regardless of loading order', () => {
  const workflows = [metadata, { ...metadata, key: 'qwen_image_21_t2i' }];
  assert.equal(resolveAvailableWorkflow('retired_provider', workflows), 'qwen_image_21_t2i');
  assert.equal(resolveAvailableWorkflow('minimax_h3', workflows), 'minimax_h3');
  assert.equal(resolveAvailableWorkflow('retired_provider', [metadata]), 'minimax_h3');
  assert.equal(resolveAvailableWorkflow('retired_provider', []), 'retired_provider');
});

test('retry discards a retired final image provider saved on old messages', () => {
  assert.deepEqual(getWorkflowOptions({ ...metadata, key: 'ideogram_style', parameters: [] }, {
    final_model: 'retired_provider',
  }), {});
});

test('retired Qwen seed and reference-mode options saved on sessions are not sent', () => {
  const qwen: WorkflowMetadata = {
    ...metadata,
    key: 'qwen_image_21_i2i',
    parameters: [{ name: 'qwen_steps', label: '采样步数', type: 'select', options: ['20', '25', '40', '50'], default: '40' }],
  };
  assert.deepEqual(getWorkflowOptions(qwen, { qwen_steps: '25', qwen_seed: '42', qwen_reference_mode: 'reference' }),
    { qwen_steps: '25' });
});
