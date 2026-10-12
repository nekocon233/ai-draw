import assert from 'node:assert/strict';
import test from 'node:test';
import { approveBlocker, canApprove, isPicked, pickRequirement, pickSummary, togglePick } from '../src/features/agent/gatePicks.ts';

const a = { url: '/uploads/generated/1/a.png', message_id: 'm1-reply' };
const b = { url: '/uploads/generated/1/b.png', message_id: 'm1-reply' };
const c = { url: '/uploads/generated/1/c.png', message_id: 'm2-reply' };

test('a single-pick gate replaces the previous choice', () => {
  assert.deepEqual(togglePick([a], b, 1), [b]);
  assert.deepEqual(togglePick([a], a, 1), []);
});

test('multi-pick gates stop at the limit and unpicking always works', () => {
  assert.deepEqual(togglePick([a], b, 2), [a, b]);
  assert.equal(togglePick([a, b], c, 2), null);
  assert.deepEqual(togglePick([a, b], a, 2), [b]);
  assert.equal(togglePick([], a, 0), null, 'confirm-only gates take no picks');
});

test('the same file in another round is a different pick', () => {
  const sameFileOtherRound = { url: a.url, message_id: 'm9-reply' };
  assert.equal(isPicked([a], sameFileOtherRound), false);
  assert.equal(isPicked([a], { url: a.url }), true, 'an unscoped pick matches by URL');
});

test('approval limits and wording follow the gate', () => {
  assert.equal(canApprove({ min_picks: 1, max_picks: 2 }, 0), false);
  assert.equal(canApprove({ min_picks: 1, max_picks: 2 }, 2), true);
  assert.equal(canApprove({ min_picks: 0, max_picks: 0 }, 0), true);
  assert.equal(canApprove({ min_picks: 0, max_picks: 0 }, 1), false);
  assert.equal(pickRequirement({ min_picks: 1, max_picks: 1 }), '选 1 个');
  assert.equal(pickRequirement({ min_picks: 0, max_picks: 3 }), '最多选 3 个');
  assert.equal(pickRequirement({ min_picks: 1, max_picks: 3 }), '选 1–3 个');
  assert.equal(pickRequirement({ min_picks: 0, max_picks: 0 }), '确认后继续');
});

test('a blocked approval explains what to do instead of silently disabling the button', () => {
  assert.match(approveBlocker({ min_picks: 1, max_picks: 1 }, 0) ?? '', /点「选用」，选 1 个/);
  assert.equal(approveBlocker({ min_picks: 1, max_picks: 1 }, 1), null);
  assert.match(approveBlocker({ min_picks: 0, max_picks: 0 }, 1) ?? '', /只需确认/);
  assert.equal(pickSummary({ min_picks: 1, max_picks: 2 }, 0), '还没选（选 1–2 个）');
  assert.equal(pickSummary({ min_picks: 1, max_picks: 2 }, 1), '已选 1/2');
  assert.equal(pickSummary({ min_picks: 0, max_picks: 0 }, 0), '等你确认');
});
