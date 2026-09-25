import assert from 'node:assert/strict';
import test from 'node:test';
import { createGenerationEventHandler, matchesGeneration } from '../src/features/generation/events.ts';
import type { GenerationEventPort, GenerationState } from '../src/features/generation/events.ts';
import type { LastTaskInfo } from '../src/types/api.ts';
import { getGenerationCount } from '../src/utils/workflowOptions.ts';
import type { WorkflowMetadata } from '../src/types/api.ts';

function setup() {
  let state: GenerationState = {
    isGenerating: true, currentGeneratingMessageId: 'reply-a', currentGenerationTaskId: 'task-a',
    generationRevision: 1, currentSessionId: 'session-a',
  };
  const notices: string[] = [];
  const media: string[] = [];
  const port: GenerationEventPort = {
    getState: () => state,
    start: (messageId, taskId) => { state = {
      ...state, currentGeneratingMessageId: messageId, currentGenerationTaskId: taskId,
      isGenerating: true, generationRevision: state.generationRevision + 1,
    }; },
    finish: () => { state = {
      ...state, currentGeneratingMessageId: null, currentGenerationTaskId: null,
      isGenerating: false, generationRevision: state.generationRevision + 1,
    }; },
    retainImages: () => {},
    appendMedia: (_messageId, image) => { media.push(image); },
    refreshRound: async () => ['image.png'],
    notify: (kind, text) => { notices.push(kind + ':' + text); },
  };
  return { port, notices, media, handler: createGenerationEventHandler(port) };
}

test('drops stale task events and errors without task identity', async () => {
  const { port, notices, handler } = setup();
  await handler({ type: 'state_change', field: 'error', value: 'old failure', task_id: 'old-task' });
  await handler({ type: 'state_change', field: 'error', value: 'unscoped failure' });
  await handler({ type: 'state_change', field: 'error', value: 'legacy stale failure', message_id: 'reply-a' });
  assert.equal(port.getState().isGenerating, true);
  assert.deepEqual(notices, []);
});

test('requires matching message identity even when task id matches', () => {
  const { port } = setup();
  assert.equal(matchesGeneration({
    type: 'state_change', task_id: 'task-a', message_id: 'reply-b',
  }, port.getState()), false);
});

test('validates media payloads before appending', async () => {
  const { handler, media } = setup();
  for (const value of [null, false, { image: 'x', index: -1 }, { image: null, index: 0 }]) {
    await handler({ type: 'state_change', field: 'media_generated', value, task_id: 'task-a' });
  }
  await handler({ type: 'state_change', field: 'media_generated', value: { image: 'new.png', index: 0 }, task_id: 'task-a' });
  assert.deepEqual(media, ['new.png']);
});

test('completion refreshes persisted results and releases generation state', async () => {
  const { handler, notices, port } = setup();
  await handler({ type: 'state_change', field: 'is_generating', value: false, task_id: 'task-a', session_id: 'session-a' });
  assert.equal(port.getState().isGenerating, false);
  assert.match(notices[0], /^success:/);
});

test('reconnect restores the running task identity', async () => {
  const { handler, port } = setup();
  const lastTask: LastTaskInfo = {
    message_id: 'reply-b', session_id: 'session-b', task_id: 'task-b', status: 'running',
    images: [], error: null, finished_at: null,
  };
  await handler({ type: 'initial_state', data: { is_generating: true, last_task: lastTask } });
  assert.equal(port.getState().currentGenerationTaskId, 'task-b');
});

test('late completed snapshot cannot clear a new submission', async () => {
  const { handler, port } = setup();
  const lastTask: LastTaskInfo = {
    message_id: 'old-reply', session_id: 'session-a', task_id: 'old-task', status: 'completed',
    images: ['old.png'], error: null, finished_at: 123,
  };
  await handler({ type: 'initial_state', data: { is_generating: false, last_task: lastTask } });
  assert.equal(port.getState().currentGenerationTaskId, 'task-a');
});

test('late completion response does not notify success for a newer task', async () => {
  const { port, notices } = setup();
  let release!: (images: string[]) => void;
  port.refreshRound = () => new Promise(resolve => { release = resolve; });
  const handler = createGenerationEventHandler(port);
  const finished = handler({
    type: 'state_change', field: 'is_generating', value: false,
    task_id: 'task-a', session_id: 'session-a',
  });
  port.start('reply-b', 'task-b');
  release(['old.png']);
  await finished;
  assert.deepEqual(notices, []);
  assert.equal(port.getState().currentGenerationTaskId, 'task-b');
});

test('uses workflow capabilities for count without hardcoded workflow ids', () => {
  const metadata: WorkflowMetadata = {
    key: 'future-video-provider', label: 'Future', description: '', requires_image: false,
    output_type: 'video', parameters: [],
  };
  assert.equal(getGenerationCount(metadata, 8), 1);
  assert.equal(getGenerationCount({ ...metadata, output_type: 'image', max_count: 4 }, 8), 4);
  assert.equal(getGenerationCount(metadata, Number.NaN), 1);
});

test('progress events remain scoped to the current task without changing images', async () => {
  const { port, media } = setup();
  const progress: string[] = [];
  port.progress = text => progress.push(text);
  const handle = createGenerationEventHandler(port);
  await handle({ type: 'state_change', field: 'generation_progress', value: 'old', task_id: 'old-task' });
  assert.deepEqual(progress, []);
  await handle({ type: 'state_change', field: 'generation_progress', value: 'stage 2', task_id: 'task-a' });
  assert.deepEqual(progress, ['stage 2']);
  assert.deepEqual(media, []);
  assert.equal(port.getState().isGenerating, true);
});
