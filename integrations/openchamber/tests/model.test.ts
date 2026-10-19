import { describe, expect, test } from 'bun:test';
import type { ChatMessage, Gate } from '../panel/api';
import {
  absoluteUrl, approveLabel, buildRounds, canApprove, isVideo, orderGates, orderRounds, parseJobLog, pickKey, picksFromSelection,
  relativeUrl, ruleText, selectionFromPicks, sessionJobs, sessionLabel, togglePick,
} from '../panel/model';

const gate = (patch: Partial<Gate> = {}): Gate => ({
  gate_id: 'g1', session_id: 's1', job: 'heroine_walk', step: 'candidates', question: '选一张', min_picks: 1, max_picks: 1,
  rounds: [], status: 'open', decision: null, picks: [], note: '', cancel_reason: null, created_at: 1, updated_at: 1, submitted_at: null, ...patch,
});

const messages: ChatMessage[] = [
  { id: 'm1', type: 'user', content: '旧的提示词', timestamp: 1 },
  { id: 'm1-reply', type: 'assistant', content: '', timestamp: 2, images: ['/uploads/generated/1/a.png'] },
  { id: 'q1-reply', type: 'assistant', content: '请选一张', timestamp: 3, images: [] },      // 关卡的提问气泡
  { id: 'm2', type: 'user', content: '新的提示词\n第二行', timestamp: 4 },
  { id: 'm2-reply', type: 'assistant', content: '', timestamp: 5, images: ['https://aidraw.nekocon.cn/uploads/generated/1/b.png', '/uploads/video/1/c.mp4'] },
  { id: 'p1', type: 'user', content: '', timestamp: 6 },
  { id: 'p1-reply', type: 'assistant', content: '抠好的透明成品，230 px 高', timestamp: 7, images: ['/uploads/agent/1/202610/d.png'] },
];

describe('地址', () => {
  test('相对地址补上 ai-draw 的源，完整地址和 data 地址原样', () => {
    expect(absoluteUrl('/uploads/a.png')).toBe('https://aidraw.nekocon.cn/uploads/a.png');
    expect(absoluteUrl('https://example.com/x.png')).toBe('https://example.com/x.png');
    expect(absoluteUrl('data:image/png;base64,AA')).toBe('data:image/png;base64,AA');
    expect(relativeUrl('https://aidraw.nekocon.cn/uploads/a.png')).toBe('/uploads/a.png');
  });

  test('按扩展名和 data 类型认出视频', () => {
    expect(isVideo('/uploads/video/1/c.mp4')).toBe(true);
    expect(isVideo('/uploads/x.webm?t=1')).toBe(true);
    expect(isVideo('data:video/mp4;base64,AA')).toBe(true);
    expect(isVideo('/uploads/generated/1/a.png')).toBe(false);
  });

  test('选用的 key 不受地址写法影响', () => {
    expect(pickKey('m2-reply', 'https://aidraw.nekocon.cn/uploads/b.png')).toBe(pickKey('m2-reply', '/uploads/b.png'));
  });
});

describe('候选', () => {
  test('只取带结果的助手消息，说明优先用帖子正文，其次提示词第一行', () => {
    const rounds = buildRounds(messages);
    expect(rounds.map((round) => round.messageId)).toEqual(['m1-reply', 'm2-reply', 'p1-reply']);
    expect(rounds[1]?.text).toBe('新的提示词');
    expect(rounds[2]?.text).toBe('抠好的透明成品，230 px 高');
    expect(rounds[1]?.items.map((item) => [item.url, item.video])).toEqual([['/uploads/generated/1/b.png', false], ['/uploads/video/1/c.mp4', true]]);
  });

  test('关卡建议的轮次排前面，其余从新到旧，编号连续', () => {
    const ordered = orderRounds(buildRounds(messages), ['m1-reply']);
    expect(ordered.map((round) => round.messageId)).toEqual(['m1-reply', 'p1-reply', 'm2-reply']);
    expect(ordered.flatMap((round) => round.items.map((item) => item.number))).toEqual([1, 2, 3, 4]);
  });

  test('同一轮出现两次只留一份', () => {
    const twice = [...messages, messages[1] as ChatMessage];
    expect(orderRounds(buildRounds(twice), []).length).toBe(3);
  });
});

describe('选用规则', () => {
  test('说明文字', () => {
    expect(ruleText(gate({ min_picks: 0, max_picks: 0 }))).toBe('只需确认');
    expect(ruleText(gate({ min_picks: 0, max_picks: 1 }))).toBe('可以选 1 个，也可以不选');
    expect(ruleText(gate({ min_picks: 0, max_picks: 3 }))).toBe('最多选 3 个，也可以不选');
    expect(ruleText(gate({ min_picks: 2, max_picks: 2 }))).toBe('选 2 个');
    expect(ruleText(gate({ min_picks: 1, max_picks: 3 }))).toBe('选 1–3 个');
  });

  test('只能选 1 个时点新的就换掉；选满了不动；只需确认时不能选', () => {
    expect(togglePick(['a'], 'b', 1)).toEqual(['b']);
    expect(togglePick(['a'], 'a', 1)).toEqual([]);
    const full = ['a', 'b'];
    expect(togglePick(full, 'c', 2)).toBe(full);
    expect(togglePick(['a'], 'c', 2)).toEqual(['a', 'c']);
    const none: string[] = [];
    expect(togglePick(none, 'a', 0)).toBe(none);
  });

  test('能不能提交、按钮叫什么', () => {
    expect(canApprove(gate({ min_picks: 1, max_picks: 1 }), 0)).toBe(false);
    expect(canApprove(gate({ min_picks: 1, max_picks: 1 }), 1)).toBe(true);
    expect(canApprove(gate({ min_picks: 0, max_picks: 0 }), 0)).toBe(true);
    expect(canApprove(gate({ min_picks: 0, max_picks: 1 }), 0)).toBe(true);
    expect(approveLabel(gate({ min_picks: 0, max_picks: 1 }), 0)).toBe('满意，直接提交');
    expect(approveLabel(gate({ min_picks: 0, max_picks: 1 }), 1)).toBe('提交');
    expect(approveLabel(gate({ min_picks: 0, max_picks: 0 }), 0)).toBe('确认');
  });

  test('服务器上的选用和本地选择互相转换；没载入的轮次原样带回', () => {
    const rounds = orderRounds(buildRounds(messages), []);
    const selection = selectionFromPicks([{ url: '/uploads/generated/1/b.png', message_id: 'm2-reply' }, { url: '/uploads/old.png', message_id: 'm0-reply' }]);
    expect(picksFromSelection(selection, rounds)).toEqual([
      { url: '/uploads/generated/1/b.png', message_id: 'm2-reply' },
      { url: '/uploads/old.png', message_id: 'm0-reply' },
    ]);
  });
});

describe('任务日志', () => {
  const log = [
    JSON.stringify({ ts: '2026-10-12T18:31:01+08:00', event: 'gen_submitted', step: 'candidates', session_id: 's1', task_id: 't1' }),
    JSON.stringify({ ts: '2026-10-12T18:35:00+08:00', event: 'gate_open', step: 'candidates', session_id: 's1', gate_id: 'g1' }),
    '{"ts": "2026-10-12T18:36',   // 写到一半的行
    JSON.stringify({ ts: '2026-10-12T19:00:00+08:00', event: 'deliver', step: 'deliver', key: 'heroine_walk', file: 'public/assets/a.png' }),
    JSON.stringify({ ts: '2026-10-13T09:00:00+08:00', event: 'gen_submitted', step: 'redo', session_id: 's2', task_id: 't2' }),
  ].join('\n');

  test('取最近的会话、最后一个事件、交付过的素材和任务开始时间', () => {
    const job = parseJobLog('heroine_walk', log);
    expect(job?.sessionId).toBe('s2');
    expect(job?.sessions).toEqual(['s1', 's2']);
    expect(job?.lastEvent).toBe('gen_submitted');
    expect(job?.lastStep).toBe('redo');
    expect(job?.delivered).toEqual(['heroine_walk']);
    expect(job?.latestTaskId).toBe('t2');
    expect(job?.taskStarted.t1).toBe(Date.parse('2026-10-12T18:31:01+08:00'));
  });

  test('空日志不算任务', () => {
    expect(parseJobLog('empty', '\n\n')).toBeNull();
  });

  test('会话归到最近活动的任务；本项目的关卡排前面', () => {
    const older = parseJobLog('a', JSON.stringify({ ts: '2026-10-01T00:00:00Z', event: 'gen', step: 'x', session_id: 'shared' }));
    const newer = parseJobLog('b', JSON.stringify({ ts: '2026-10-02T00:00:00Z', event: 'gen', step: 'x', session_id: 'shared' }));
    const map = sessionJobs([newer!, older!]);
    expect(map.get('shared')).toBe('b');
    const ordered = orderGates([gate({ gate_id: 'other', session_id: 'x', created_at: 9 }), gate({ gate_id: 'mine', session_id: 'shared', created_at: 1 })], map);
    expect(ordered.map((item) => item.gate_id)).toEqual(['mine', 'other']);
  });

  test('会话标题去掉 Agent 前缀', () => {
    expect(sessionLabel('Agent · classroom 主角立绘')).toBe('classroom 主角立绘');
    expect(sessionLabel(undefined)).toBe('');
  });
});
