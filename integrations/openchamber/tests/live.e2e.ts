// 对真实 ai-draw 的端到端测试。不生成图片，不占生成槽。运行：bun tests/live.e2e.ts
// 开一个临时会话，转发两张已有的图，然后在模拟宿主里用打包好的面板走一遍：
// 选用并提交、只需确认、写意见重来。agent 一侧用 aidraw gate wait 读回答。最后删掉临时会话（关卡跟着删）。
// 模拟宿主把 request 转给 https://aidraw.nekocon.cn，带上命令行的令牌，和 OpenChamber 服务器代发请求的方式一样。
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import type { GuestMessage, HostResultPayload } from '@openchamber/sdk';
import { closeAll, HostError, loadPanel, waitFor } from './host';

const ORIGIN = 'https://aidraw.nekocon.cn';
const IMAGES = ['/uploads/generated/1/6bd4505fd46a4af89f903d74b2cc286b.png', '/uploads/generated/1/b395e065b45b4d98b7c260e7bdfec55f.png'];
const { token } = JSON.parse(readFileSync(`${process.env.HOME}/.config/aidraw/credentials.json`, 'utf8')) as { token: string };

// 必须异步调用命令行：同步调用会卡住事件循环，面板发出的请求就没机会发出去
const run = promisify(execFile);
const cli = async (...args: string[]): Promise<Record<string, any>> => JSON.parse((await run('aidraw', ['--quiet', ...args], { encoding: 'utf8' })).stdout);

async function until(probe: () => Promise<boolean>, timeout: number, label: string): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!(await probe())) {
    if (Date.now() > deadline) throw new Error(`等不到${label}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function aidraw(method: string, path: string, query?: Record<string, string>, body?: string) {
  const url = new URL(path, ORIGIN);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method,
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body !== undefined && method !== 'GET' ? { 'Content-Type': 'application/json' } : {}) },
    body: method === 'GET' ? undefined : body,
    redirect: 'manual',
  });
  return { status: response.status, body: await response.text() };
}

const stored = new Map<string, unknown>();
const requests: string[] = [];
const handler = async (message: GuestMessage): Promise<HostResultPayload | undefined> => {
  if (message.type === 'request') {
    const { method, path, query, body } = message.payload;
    requests.push(`${method} ${path}`);
    return aidraw(method, path, query, body);
  }
  if (message.type === 'file-list' || message.type === 'file-read') throw new HostError('NOT_FOUND', '没有打开项目');
  if (message.type === 'storage') {
    const payload = message.payload;
    if (payload.op === 'get') return stored.has(payload.key) ? { storage: true, op: 'get', found: true, value: stored.get(payload.key) as never } : { storage: true, op: 'get', found: false };
    if (payload.op === 'set') { stored.set(payload.key, payload.value); return { storage: true, op: 'set' }; }
  }
  return undefined;
};

const step = (text: string) => console.log(`== ${text}`);
let failed = false;

const session = await cli('session', 'new', '--title', 'Agent · 测试 OpenChamber 面板');
const sessionId = String(session.session_id);
step(`临时会话 ${sessionId}`);
try {
  const post = await cli('post', '--session', sessionId, '--text', '测试用：转发两张已有的图（测完会删掉这个会话）', '--url', IMAGES[0]!, '--url', IMAGES[1]!);
  const reply = String(post.reply_id);

  // 1. 选用并提交（侧栏面板）
  const pick = (await cli('gate', 'open', '--session', sessionId, '--question', '测试：选第 2 张', '--min', '1', '--max', '1', '--round', reply)).gate;
  step(`选用关卡 ${pick.gate_id}`);
  const panel = await loadPanel(handler);
  panel.ready({ directory: null });
  const card = await waitFor(() => [...panel.document.querySelectorAll('.gate')].find((node) => node.textContent?.includes('测试：选第 2 张')), 15000, '选用关卡的卡片');
  await waitFor(() => card.querySelectorAll('.tile').length === 2, 15000, '两个候选');
  const second = card.querySelectorAll('.tile-pick')[1] as unknown as HTMLButtonElement;
  second.click();
  await until(async () => (await cli('gate', 'get', pick.gate_id)).gate.picks.length === 1, 15000, '选择同步到 ai-draw');
  const submit = [...card.querySelectorAll('button')].find((node) => node.textContent?.trim() === '提交') as unknown as HTMLButtonElement;
  submit.click();
  const answered = await cli('gate', 'wait', pick.gate_id, '--timeout', '30');
  const picked = answered.picks ?? answered.gate?.picks;
  console.log(JSON.stringify({ decision: answered.decision ?? answered.gate?.decision, picks: picked }));
  if ((answered.decision ?? answered.gate?.decision) !== 'approve' || !String(picked?.[0]?.url ?? '').endsWith(IMAGES[1]!)) throw new Error('agent 读到的选择不对');
  await waitFor(() => !panel.document.body.textContent?.includes('测试：选第 2 张'), 15000, '卡片收起');
  if (!panel.document.body.textContent?.includes('选了 #2')) throw new Error('“刚提交的”里没有记录');
  step('选用并提交：agent 读到 approve + 第 2 张');

  // 2. 只需确认（Work Status 区块，同时检查通知和角标）
  const confirm = (await cli('gate', 'open', '--session', sessionId, '--question', '测试：只需确认', '--min', '0', '--max', '0')).gate;
  step(`确认关卡 ${confirm.gate_id}`);
  const status = await loadPanel(handler);
  status.ready({ surface: 'status', directory: null });
  const toast = await waitFor(() => status.of('toast').find((message) => message.payload.message.includes('只需确认')), 15000, '通知');
  console.log(`   通知：${toast.payload.message}`);
  await waitFor(() => status.document.body.textContent?.includes('测试：只需确认'), 15000, '紧凑卡片');
  status.button('确认').click();
  const confirmed = await cli('gate', 'wait', confirm.gate_id, '--timeout', '30');
  if ((confirmed.decision ?? confirmed.gate?.decision) !== 'approve') throw new Error('确认关卡没有 approve');
  step('只需确认：agent 读到 approve');

  // 3. 写意见重来（侧栏面板）
  const redo = (await cli('gate', 'open', '--session', sessionId, '--question', '测试：都不满意就重来', '--min', '1', '--max', '1', '--round', reply)).gate;
  step(`重来关卡 ${redo.gate_id}`);
  const redoCard = await waitFor(() => [...panel.document.querySelectorAll('.gate')].find((node) => node.textContent?.includes('测试：都不满意就重来')), 15000, '重来关卡的卡片');
  const note = redoCard.querySelector('.note') as unknown as HTMLTextAreaElement;
  note.value = '测试意见：换个颜色';
  note.dispatchEvent(new panel.window.Event('input', { bubbles: true }) as unknown as Event);
  ([...redoCard.querySelectorAll('button')].find((node) => node.textContent?.trim() === '都不满意，重来') as unknown as HTMLButtonElement).click();
  const redone = await cli('gate', 'wait', redo.gate_id, '--timeout', '30');
  if ((redone.decision ?? redone.gate?.decision) !== 'redo' || (redone.note ?? redone.gate?.note) !== '测试意见：换个颜色') throw new Error('重来的意见不对');
  step('重来：agent 读到 redo + 意见');
  console.log(`   面板发出的请求：${[...new Set(requests)].join('，')}`);
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await closeAll();
  const removed = await aidraw('DELETE', `/api/chat/sessions/${encodeURIComponent(sessionId)}`);
  step(`删除临时会话：HTTP ${removed.status}`);
}
console.log(failed ? 'live: FAILED' : 'live: OK');
process.exit(failed ? 1 : 0);
