import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentEventHandler, isReviewGate } from '../src/features/agent/events.ts';
import type { AgentEventPort } from '../src/features/agent/events.ts';
import type { ReviewGate } from '../src/features/agent/types.ts';

const gate: ReviewGate = {
  gate_id: 'gate-1', session_id: 'session-a', job: 'heroine', step: 'style', question: '选风格',
  min_picks: 1, max_picks: 1, rounds: [], status: 'open', decision: null, picks: [], note: '',
  cancel_reason: null, created_at: 1, updated_at: 1, submitted_at: null,
};

function setup(current: string | null = 'session-a') {
  const calls: string[] = [];
  const port: AgentEventPort = {
    currentSessionId: () => current,
    applyGate: value => { calls.push(`gate:${value.gate_id}:${value.status}`); },
    reloadGates: async () => { calls.push('reload'); },
    refreshSessions: async () => { calls.push('sessions'); },
    syncSession: async sessionId => { calls.push(`sync:${sessionId}`); },
  };
  return { calls, handler: createAgentEventHandler(port) };
}

test('gate events update the store and malformed ones are ignored', async () => {
  const { calls, handler } = setup();
  await handler({ type: 'state_change', field: 'agent_gate', value: gate });
  await handler({ type: 'state_change', field: 'agent_gate', value: { ...gate, status: 'weird' } });
  await handler({ type: 'state_change', field: 'agent_gate', value: null });
  assert.deepEqual(calls, ['gate:gate-1:open']);
  assert.equal(isReviewGate({ ...gate, picks: undefined }), false);
});

test('posted rounds refresh the list and sync only the visible session', async () => {
  const { calls, handler } = setup();
  await handler({ type: 'state_change', field: 'agent_session', value: { reason: 'session_created', session_id: 'session-b' } });
  await handler({ type: 'state_change', field: 'agent_session', value: { reason: 'round_posted', session_id: 'session-b' } });
  await handler({ type: 'state_change', field: 'agent_session', value: { reason: 'round_posted', session_id: 'session-a' } });
  assert.deepEqual(calls, ['sessions', 'sessions', 'sessions', 'sync:session-a']);
});

test('a reconnect reloads gates and catches up on the visible session', async () => {
  const { calls, handler } = setup();
  await handler({ type: 'initial_state', data: {} });
  assert.deepEqual(calls, ['reload', 'sync:session-a']);
  const idle = setup(null);
  await idle.handler({ type: 'initial_state', data: {} });
  assert.deepEqual(idle.calls, ['reload']);
});
