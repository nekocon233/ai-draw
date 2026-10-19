import { afterEach, describe, expect, test } from 'bun:test';
import type { GuestMessage, HostResultPayload, JsonValue } from '@openchamber/sdk';
import type { Gate } from '../panel/api';
import { closeAll, HostError, loadPanel, waitFor } from './host';

afterEach(closeAll);

const now = Date.now();
const jobLog = [
  JSON.stringify({ ts: new Date(now - 120000).toISOString(), event: 'gen_submitted', step: 'candidates', session_id: 's1', task_id: 't1' }),
  JSON.stringify({ ts: new Date(now - 60000).toISOString(), event: 'gate_open', step: 'candidates', session_id: 's1', gate_id: 'g1' }),
].join('\n');

const history = {
  messages: [
    { id: 'm1', type: 'user', content: '旧提示词', timestamp: 1 },
    { id: 'm1-reply', type: 'assistant', content: '', timestamp: 2, images: ['/uploads/generated/1/a.png'] },
    { id: 'm2', type: 'user', content: '新提示词\n第二行', timestamp: 3 },
    { id: 'm2-reply', type: 'assistant', content: '', timestamp: 4, images: ['/uploads/generated/1/b.png', '/uploads/video/1/c.mp4'] },
  ],
  has_more: false,
};

const openGate = (patch: Partial<Gate> = {}): Gate => ({
  gate_id: 'g1', session_id: 's1', job: 'heroine_walk', step: 'candidates', question: '选一张最好的', min_picks: 1, max_picks: 1,
  rounds: ['m2-reply'], status: 'open', decision: null, picks: [], note: '', cancel_reason: null,
  created_at: now - 60000, updated_at: 1, submitted_at: null, ...patch,
});

interface Call { method: string; path: string; query?: Record<string, string>; body?: unknown }

/** 内存里的 ai-draw：记录每个请求，按路径回应。 */
function fakeAidraw(options: { gates?: Gate[]; submitStatus?: number; stored?: Record<string, number> } = {}) {
  const storage = new Map<string, JsonValue>();
  if (options.stored) storage.set('notified-gates', options.stored);
  const state = { gates: options.gates ?? [openGate()], calls: [] as Call[], storage,
    get stored() { return storage.get('notified-gates'); } };
  const json = (status: number, body: unknown) => ({ status, body: JSON.stringify(body) });
  const handler = (message: GuestMessage): HostResultPayload | undefined => {
    if (message.type === 'request') {
      const { method, path, query, body } = message.payload;
      state.calls.push({ method, path, query, body: body ? JSON.parse(body) : undefined });
      if (path === '/api/agent/gates') return json(200, { gates: state.gates });
      if (path === '/api/chat/history') return json(200, history);
      if (path === '/api/chat/sessions') return json(200, [{ id: 's1', title: 'Agent · classroom 步行', updated_at: 1 }]);
      if (path === '/api/agent/slot') return json(200, { busy: false });
      if (path.endsWith('/picks')) return json(200, state.gates[0]);
      if (path.endsWith('/submit')) {
        if (options.submitStatus && options.submitStatus !== 200) return json(options.submitStatus, { detail: '这个审核已经结束' });
        state.gates = [];
        return json(200, { ...openGate(), status: 'submitted' });
      }
      return json(404, { detail: 'not found' });
    }
    if (message.type === 'file-list') return { entries: [{ name: 'heroine_walk.jsonl', kind: 'file' }] };
    if (message.type === 'file-read') return { content: jobLog };
    if (message.type === 'storage') {
      const payload = message.payload;
      if (payload.op === 'get') {
        const value = storage.get(payload.key);
        return value === undefined ? { storage: true, op: 'get', found: false } : { storage: true, op: 'get', found: true, value };
      }
      if (payload.op === 'set') { storage.set(payload.key, payload.value); return { storage: true, op: 'set' }; }
      return { storage: true, op: payload.op } as HostResultPayload;
    }
    return undefined;
  };
  return { state, handler };
}

describe('侧栏面板', () => {
  test('显示关卡建议的那一轮，选用同步到 ai-draw，提交后记在“刚提交的”里', async () => {
    const aidraw = fakeAidraw();
    const app = await loadPanel(aidraw.handler);
    app.ready();
    const tiles = await waitFor(() => app.document.querySelectorAll('.tile').length === 2 && app.document.querySelectorAll('.tile'), 3000, '两个候选');
    expect(app.document.querySelector('.gate-title')?.textContent).toBe('heroine_walk');
    expect(app.document.querySelector('.gate-meta')?.textContent).toContain('选 1 个');
    expect(app.document.querySelector('.round-text')?.textContent).toBe('新提示词');
    expect(tiles[1]?.classList.contains('video')).toBe(true);
    expect(app.document.querySelector('.more')?.textContent).toBe('显示更早的结果（1 轮）');

    // 没选时不能提交
    expect(app.button('提交').disabled).toBe(true);
    app.q<HTMLButtonElement>('.tile-pick').click();
    await waitFor(() => aidraw.state.calls.find((call) => call.path === '/api/agent/gates/g1/picks'), 3000, '同步选择');
    expect(aidraw.state.calls.find((call) => call.path.endsWith('/picks'))?.body).toEqual({ picks: [{ url: '/uploads/generated/1/b.png', message_id: 'm2-reply' }] });
    expect(app.document.querySelector('.tile.selected .tile-number')?.textContent).toBe('#1');

    app.button('提交').click();
    const submit = await waitFor(() => aidraw.state.calls.find((call) => call.path === '/api/agent/gates/g1/submit'), 3000, '提交');
    expect(submit.method).toBe('POST');
    expect(submit.body).toEqual({ decision: 'approve', picks: [{ url: '/uploads/generated/1/b.png', message_id: 'm2-reply' }], note: '' });
    await waitFor(() => !app.document.querySelector('.gate'), 3000, '卡片消失');
    expect(app.document.body.textContent).toContain('选了 #1');
    // 侧栏面板开着时不弹通知，但记下已经看过
    expect(app.of('toast').length).toBe(0);
    expect(aidraw.state.stored).toHaveProperty('g1');
  });

  test('“显示更早的结果”展开其他轮次，编号接着排', async () => {
    const app = await loadPanel(fakeAidraw().handler);
    app.ready();
    await waitFor(() => app.document.querySelector('.more:not([hidden])'), 3000, '更多按钮');
    app.q<HTMLButtonElement>('.more').click();
    await waitFor(() => app.document.querySelectorAll('.tile').length === 3, 3000, '三个候选');
    expect([...app.document.querySelectorAll('.tile-number')].map((node) => node.textContent)).toEqual(['#1', '#2', '#3']);
  });

  test('重来必须写意见', async () => {
    const aidraw = fakeAidraw();
    const app = await loadPanel(aidraw.handler);
    app.ready();
    await waitFor(() => app.document.querySelector('.tile'), 3000, '候选');
    app.button('都不满意，重来').click();
    await waitFor(() => app.document.querySelector('.gate-error:not([hidden])'), 3000, '提示');
    expect(app.document.querySelector('.gate-error')?.textContent).toContain('写一句要改什么');
    expect(aidraw.state.calls.some((call) => call.path.endsWith('/submit'))).toBe(false);

    const note = app.q<HTMLTextAreaElement>('.note');
    note.value = '脸再圆一点';
    note.dispatchEvent(new app.window.Event('input', { bubbles: true }) as unknown as Event);
    app.button('都不满意，重来').click();
    const submit = await waitFor(() => aidraw.state.calls.find((call) => call.path.endsWith('/submit')), 3000, '提交');
    expect(submit.body).toEqual({ decision: 'redo', picks: [], note: '脸再圆一点' });
  });

  test('交付后关卡可以不选直接提交', async () => {
    const aidraw = fakeAidraw({ gates: [openGate({ min_picks: 0, max_picks: 1, question: '交付好了，满意就直接提交' })] });
    const app = await loadPanel(aidraw.handler);
    app.ready();
    await waitFor(() => app.document.querySelector('.tile'), 3000, '候选');
    app.button('满意，直接提交').click();
    const submit = await waitFor(() => aidraw.state.calls.find((call) => call.path.endsWith('/submit')), 3000, '提交');
    expect(submit.body).toEqual({ decision: 'approve', picks: [], note: '' });
  });

  test('关卡已在别处结束时收起卡片并说明', async () => {
    const app = await loadPanel(fakeAidraw({ submitStatus: 409 }).handler);
    app.ready();
    await waitFor(() => app.document.querySelector('.tile'), 3000, '候选');
    app.q<HTMLButtonElement>('.tile-pick').click();
    app.button('提交').click();
    await waitFor(() => app.document.querySelector('.notice'), 3000, '提示');
    expect(app.document.querySelector('.notice')?.textContent).toContain('已经结束');
    expect(app.document.querySelector('.gate')).toBeNull();
  });

  test('列出本项目的素材任务', async () => {
    const app = await loadPanel(fakeAidraw({ gates: [] }).handler);
    app.ready();
    await waitFor(() => app.document.querySelector('.jobs li'), 3000, '任务列表');
    expect(app.document.querySelector('.jobs li')?.textContent).toContain('heroine_walk');
    expect(app.document.querySelector('.jobs li')?.textContent).toContain('等你挑选');
  });

  test('任务整块折叠，轮询保持状态和标题焦点，按项目恢复且重开后仍记住', async () => {
    const aidraw = fakeAidraw({ gates: [] });
    const app = await loadPanel(aidraw.handler);
    app.ready();
    await waitFor(() => app.document.querySelector('.jobs li'));
    const summary = app.q<HTMLElement>('.jobs-section summary');
    const details = app.q<HTMLDetailsElement>('.jobs-section');
    expect(summary.textContent).toBe('本项目的素材任务（1）');
    expect(details.open).toBe(true);
    summary.click();
    await waitFor(() => [...aidraw.state.storage].some(([key, value]) => key.startsWith('jobs-collapsed:') && value === true));
    summary.focus();
    await new Promise((resolve) => setTimeout(resolve, 3200));
    expect(app.q('.jobs-section summary')).toBe(summary);
    expect(app.document.activeElement?.matches('.jobs-section summary')).toBe(true);
    expect(details.open).toBe(false);
    expect(summary.getAttribute('aria-expanded')).toBe('false');

    app.ready({ directory: '/opt/other-project' });
    await waitFor(() => details.open);
    app.ready({ directory: '/opt/classroom' });
    await waitFor(() => !details.open);
    const reopened = await loadPanel(aidraw.handler);
    reopened.ready();
    await waitFor(() => reopened.document.querySelector('.jobs li') && !reopened.q<HTMLDetailsElement>('.jobs-section').open);
    reopened.q<HTMLElement>('.jobs-section summary').click();
    await waitFor(() => [...aidraw.state.storage].some(([key, value]) => key.startsWith('jobs-collapsed:') && value === false));
  }, 10000);

  test('迟到的折叠状态读取不会覆盖用户刚点的状态', async () => {
    const aidraw = fakeAidraw({ gates: [] });
    let finish: ((result: HostResultPayload) => void) | undefined;
    const app = await loadPanel((message) => {
      if (message.type === 'storage' && message.payload.op === 'get' && message.payload.key.startsWith('jobs-collapsed:')) {
        return new Promise((resolve) => { finish = resolve; });
      }
      return aidraw.handler(message);
    });
    app.ready();
    await waitFor(() => finish && app.document.querySelector('.jobs li'));
    app.q<HTMLElement>('.jobs-section summary').click();
    finish?.({ storage: true, op: 'get', found: true, value: false });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(app.q<HTMLDetailsElement>('.jobs-section').open).toBe(false);
  });

  test('其他项目迟到的折叠状态不会改变当前项目', async () => {
    const aidraw = fakeAidraw({ gates: [] });
    let finish: ((result: HostResultPayload) => void) | undefined;
    const app = await loadPanel((message) => {
      if (!finish && message.type === 'storage' && message.payload.op === 'get' && message.payload.key.startsWith('jobs-collapsed:')) {
        return new Promise((resolve) => { finish = resolve; });
      }
      return aidraw.handler(message);
    });
    app.ready();
    await waitFor(() => finish && app.document.querySelector('.jobs li'));
    app.ready({ directory: '/opt/other-project' });
    finish?.({ storage: true, op: 'get', found: true, value: true });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(app.q<HTMLDetailsElement>('.jobs-section').open).toBe(true);
  });

  test('保存折叠状态失败时保留当前状态并提示', async () => {
    const aidraw = fakeAidraw({ gates: [] });
    const app = await loadPanel((message) => {
      if (message.type === 'storage' && message.payload.op === 'set' && message.payload.key.startsWith('jobs-collapsed:')) {
        throw new HostError('REQUEST_FAILED', 'Storage unavailable');
      }
      return aidraw.handler(message);
    });
    app.ready();
    await waitFor(() => app.document.querySelector('.jobs li'));
    app.q<HTMLElement>('.jobs-section summary').click();
    await waitFor(() => app.document.querySelector('.notice')?.textContent?.includes('未能保存'));
    expect(app.q<HTMLDetailsElement>('.jobs-section').open).toBe(false);
  });

  test('两个会话入口直接请求内置浏览器，不写剪贴板，并保留选择与意见', async () => {
    const aidraw = fakeAidraw();
    const app = await loadPanel(aidraw.handler);
    app.ready();
    await waitFor(() => app.document.querySelector('.tile') && app.document.querySelector('.jobs li'));
    app.q<HTMLButtonElement>('.tile-pick').click();
    const note = app.q<HTMLTextAreaElement>('.note');
    note.value = '保留这条修改意见';
    note.dispatchEvent(new app.window.Event('input', { bubbles: true }) as unknown as Event);
    app.button('打开会话').click();
    app.button('在浏览器标签打开').click();
    expect(app.of('open-browser').map((message) => message.payload.url)).toEqual([
      'https://aidraw.nekocon.cn/?session=s1', 'https://aidraw.nekocon.cn/?session=s1',
    ]);
    expect(app.of('clipboard-write')).toHaveLength(0);
    expect(app.of('open-surface')).toHaveLength(0);
    expect(app.document.querySelector('.tile.selected')).not.toBeNull();
    expect(note.value).toBe('保留这条修改意见');
  });

  test('旧宿主明确提示不支持直接打开，没有复制粘贴流程', async () => {
    const app = await loadPanel(fakeAidraw().handler);
    app.ready({ features: {} });
    await waitFor(() => app.document.querySelector('.jobs li'));
    app.button('打开会话').click();
    await waitFor(() => app.document.querySelector('.notice')?.textContent?.includes('请更新 OpenChamber'));
    expect(app.of('open-browser')).toHaveLength(0);
    expect(app.of('clipboard-write')).toHaveLength(0);
  });

  test('宿主拒绝打开时显示原因', async () => {
    const aidraw = fakeAidraw();
    const app = await loadPanel((message) => {
      if (message.type === 'open-browser') throw new HostError('NO_DIRECTORY', 'No project is open.');
      return aidraw.handler(message);
    });
    app.ready();
    await waitFor(() => app.document.querySelector('.jobs li'));
    app.button('打开会话').click();
    await waitFor(() => app.document.querySelector('.notice')?.textContent?.includes('请先打开一个项目'));
  });

  test('未连接时只提示去设置里粘贴令牌，不发请求', async () => {
    const aidraw = fakeAidraw();
    const app = await loadPanel(aidraw.handler);
    app.ready({ connection: { connected: false, account: '' } });
    await waitFor(() => app.document.body.textContent?.includes('还没连接 ai-draw'), 3000, '提示');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(aidraw.state.calls.length).toBe(0);
  });

  test('令牌失效时提示重新粘贴', async () => {
    const app = await loadPanel((message) => {
      if (message.type === 'request') throw new HostError('DISCONNECTED', 'Not connected.');
      if (message.type === 'file-list') throw new HostError('NOT_FOUND', 'missing');
      return undefined;
    });
    app.ready();
    await waitFor(() => app.document.querySelector('.banner'), 3000, '提示');
    expect(app.document.querySelector('.banner')?.textContent).toContain('重新粘贴令牌');
  });
});

describe('Work Status 区块', () => {
  test('新关卡弹一次通知、加角标；紧凑显示并报告高度', async () => {
    const aidraw = fakeAidraw();
    const app = await loadPanel(aidraw.handler);
    app.ready({ surface: 'status', features: { statusControls: true } });
    const toast = await waitFor(() => app.of('toast')[0], 3000, '通知');
    expect(toast.payload.message).toBe('ai-draw：heroine_walk 等你挑选（选 1 个）');
    expect(app.of('badge').at(-1)?.payload).toEqual({ count: 1 });
    expect(app.of('status-controls')[0]?.payload.controls.map((control) => control.id)).toEqual(['refresh', 'open-panel']);
    await waitFor(() => app.document.querySelector('.gate.compact .tile'), 3000, '紧凑卡片');
    expect(app.of('resize').length).toBeGreaterThan(0);
    expect(app.document.querySelector('.more:not([hidden])')).toBeNull();

    // 主题变了重发 ready：不重复通知
    app.ready({ surface: 'status', features: { statusControls: true }, theme: { mode: 'dark', tokens: (await import('./host')).context.theme.tokens } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(app.of('toast').length).toBe(1);
  });

  test('已经通知过的关卡不再通知', async () => {
    const app = await loadPanel(fakeAidraw({ stored: { g1: now } }).handler);
    app.ready({ surface: 'status' });
    await waitFor(() => app.document.querySelector('.gate.compact .tile'), 3000, '紧凑卡片');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(app.of('toast').length).toBe(0);
  });

  test('紧凑模式下“重来”先展开意见框，再确认', async () => {
    const aidraw = fakeAidraw();
    const app = await loadPanel(aidraw.handler);
    app.ready({ surface: 'status' });
    await waitFor(() => app.document.querySelector('.gate.compact .tile'), 3000, '紧凑卡片');
    expect(app.q<HTMLTextAreaElement>('.note').hidden).toBe(true);
    app.button('都不满意，重来').click();
    await waitFor(() => !app.q<HTMLTextAreaElement>('.note').hidden, 3000, '意见框');
    const note = app.q<HTMLTextAreaElement>('.note');
    note.value = '换个姿势';
    note.dispatchEvent(new app.window.Event('input', { bubbles: true }) as unknown as Event);
    app.button('确认重来').click();
    const submit = await waitFor(() => aidraw.state.calls.find((call) => call.path.endsWith('/submit')), 3000, '提交');
    expect(submit.body).toEqual({ decision: 'redo', picks: [], note: '换个姿势' });
  });

  test('没有待选时显示一行最近动态', async () => {
    const app = await loadPanel(fakeAidraw({ gates: [] }).handler);
    app.ready({ surface: 'status' });
    await waitFor(() => app.document.body.textContent?.includes('没有待选的'), 3000, '空状态');
    expect(app.document.body.textContent).toContain('heroine_walk 等你挑选');
    // 没有待选时只会清掉角标
    expect(app.of('badge').every((message) => message.payload.count === null)).toBe(true);
  });
});
