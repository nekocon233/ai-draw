import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeSessionTail, withReplyPlaceholder } from '../src/features/agent/sessionTail.ts';
import type { ChatMessage } from '../src/types/models.ts';

function message(id: string, timestamp: number, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, session_id: 's', type: id.endsWith('-reply') ? 'assistant' : 'user', content: id, timestamp, ...extra };
}

test('keeps older loaded pages and replaces the newest window', () => {
  const local = [message('old', 1), message('m1', 2), message('m1-reply', 2, { images: ['stale.png'] })];
  const fetched = [message('m1', 2), message('m1-reply', 2, { images: ['fresh.png'] }), message('m2', 3), message('m2-reply', 3)];
  const merged = mergeSessionTail(local, fetched);
  assert.deepEqual(merged.messages.map(item => item.id), ['old', 'm1', 'm1-reply', 'm2', 'm2-reply']);
  assert.deepEqual(merged.messages[2].images, ['fresh.png']);
  assert.equal(merged.keptOlder, true);
});

test('without overlap the window replaces everything; an empty session clears', () => {
  const merged = mergeSessionTail([message('a', 1)], [message('z', 9)]);
  assert.deepEqual(merged.messages.map(item => item.id), ['z']);
  assert.equal(merged.keptOlder, false);
  assert.deepEqual(mergeSessionTail([message('a', 1)], []).messages, []);
});

test('falls back to timestamps when the window starts inside a gap', () => {
  const local = [message('a', 1), message('b', 2), message('c', 5)];
  const merged = mergeSessionTail(local, [message('x', 4), message('c', 5)]);
  assert.deepEqual(merged.messages.map(item => item.id), ['a', 'b', 'x', 'c']);
});

test('a placeholder reply follows its user message and copies its parameters', () => {
  const history = [message('m1', 1, { params: { workflow: 'qwen_image_21_t2i', count: 4 } }), message('m2', 2)];
  const result = withReplyPlaceholder(history, 's', 'm1-reply', 99);
  assert.deepEqual(result.map(item => item.id), ['m1', 'm1-reply', 'm2']);
  assert.deepEqual(result[1].images, [{ loading: true }]);
  assert.equal(result[1].params?.count, 4);
  assert.equal(result[1].timestamp, 1);
  assert.deepEqual(withReplyPlaceholder(result, 's', 'm1-reply', 99).map(item => item.id), ['m1', 'm1-reply', 'm2']);
  assert.deepEqual(withReplyPlaceholder(history, 's', 'unknown-reply', 99).at(-1)?.timestamp, 99);
});

test('a task appending to a round with results gets one pending tile after them', () => {
  const history = [message('m1', 1), message('m1-reply', 1, { images: ['a.mp4'] }), message('m2', 2)];
  const result = withReplyPlaceholder(history, 's', 'm1-reply', 99);
  assert.deepEqual(result.map(item => item.id), ['m1', 'm1-reply', 'm2']);
  assert.deepEqual(result[1].images, ['a.mp4', { loading: true }]);
  assert.deepEqual(history[1].images, ['a.mp4'], 'the input history is not changed');
  assert.deepEqual(withReplyPlaceholder(result, 's', 'm1-reply', 99)[1].images, ['a.mp4', { loading: true }]);
  const empty = [message('m1', 1), message('m1-reply', 1, { images: [] })];
  assert.deepEqual(withReplyPlaceholder(empty, 's', 'm1-reply', 99)[1].images, [], 'an empty round keeps its own state');
});
