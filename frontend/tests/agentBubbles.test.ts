import assert from 'node:assert/strict';
import test from 'node:test';
import {
  agentBubbleKind, agentPostText, answerReceipt, isVideoUrl, pickHint, questionStatus, sourceMessageId,
} from '../src/features/agent/bubbles.ts';
import type { ChatMessage } from '../src/types/models.ts';

const message = (fields: Partial<ChatMessage>): ChatMessage => ({
  id: 'm', session_id: 's', type: 'user', content: '', timestamp: 0, ...fields,
} as ChatMessage);
const gate = (type: 'user' | 'assistant', kind: string, id: string, extra: Record<string, string | number> = {}) => message({
  id, type, params: { workflow: 'agent_gate', workflowOptions: { agent_gate: kind, gate_id: 'g', ...extra } },
});

test('a gate leaves the question on the agent side and the answer on the user side', () => {
  const history = [
    gate('user', 'question', 'q'), gate('assistant', 'question', 'q-reply'),
    gate('user', 'answer', 'a'), gate('assistant', 'answer', 'a-reply'),
  ];
  assert.deepEqual(history.map(item => agentBubbleKind(item, history)), ['hidden', 'question', 'answer', 'hidden']);
});

test('posted assets carry their text on the agent side, marked or from before posts were marked', () => {
  const marked = [
    message({ id: 'p', content: '成品', params: { workflow: 'agent_post' } }),
    message({ id: 'p-reply', type: 'assistant', content: '成品', images: ['/u/a.png'], params: { workflow: 'agent_post' } }),
  ];
  assert.deepEqual(marked.map(item => agentBubbleKind(item, marked)), ['hidden', 'post-text']);
  const unmarked = [message({ id: 'o', content: '旧帖子' }), message({ id: 'o-reply', type: 'assistant', images: ['/u/b.png'] })];
  assert.deepEqual(unmarked.map(item => agentBubbleKind(item, unmarked)), ['hidden', 'post-text']);
  assert.equal(agentPostText(unmarked[1], unmarked), '旧帖子');
  assert.equal(sourceMessageId('o-reply'), 'o');
});

test('ordinary rounds stay as they are', () => {
  const history = [
    message({ id: 'g', content: '画一只猫', params: { workflow: 'qwen_image_21_t2i' } }),
    message({ id: 'g-reply', type: 'assistant', images: ['/u/c.png'] }),
  ];
  assert.deepEqual(history.map(item => agentBubbleKind(item, history)), [null, null]);
});

test('the question says how many to pick and what became of it', () => {
  assert.equal(pickHint({ min_picks: 1, max_picks: 1 }), '选 1 个');
  assert.equal(pickHint({ min_picks: 0, max_picks: 1 }), '最多选 1 个，也可以不选');
  assert.equal(pickHint({ min_picks: 1, max_picks: 3 }), '选 1–3 个');
  assert.equal(pickHint({ min_picks: 0, max_picks: 0 }), '只需确认');
  assert.equal(questionStatus({ status: 'open' }), '等你回答');
  assert.equal(questionStatus({ status: 'submitted' }), '已回答');
  assert.equal(questionStatus({ status: 'cancelled', cancel_reason: '已被新的审核替换' }), '已撤销：已被新的审核替换');
});

test('an unread answer says so, which tells the user no agent is listening', () => {
  assert.deepEqual(answerReceipt({ acknowledged_at: 1791866200412 }), { read: true, text: 'Agent 已收到' });
  const waiting = answerReceipt({});
  assert.equal(waiting.text, '等待 Agent 读取');
  assert.equal(waiting.read, false);
  assert.match(waiting.hint ?? '', /对话/);
  assert.equal(isVideoUrl('/uploads/video/1/a.mp4'), true);
  assert.equal(isVideoUrl('/uploads/spritesheet/1/a.png'), false);
});
