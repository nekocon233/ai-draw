import assert from 'node:assert/strict';
import test from 'node:test';

import type { WorkflowMetadata } from '../src/types/api.ts';
import { getWorkflowOptions } from '../src/utils/workflowOptions.ts';

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
