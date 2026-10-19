// 纯逻辑：候选怎么排、选用规则、任务日志怎么读。不碰 DOM，也不发请求，tests/model.test.ts 直接测。
import { AIDRAW_ORIGIN, type ChatMessage, type Gate, type GatePick } from './api';

export interface Candidate {
  key: string;          // `${messageId}|${相对地址}`，和关卡里的 picks 对得上
  url: string;          // ai-draw 存的地址（一般是 /uploads/...）
  src: string;          // 给 <img> / <video> 用的完整地址
  messageId: string;    // 结果所在的助手消息
  video: boolean;
  number: number;       // 这个关卡里从 1 开始的编号，用户在对话里可以说“选 3”
}

export interface CandidateRound {
  messageId: string;
  text: string;         // 这一轮的说明：agent 发的素材帖取帖子说明，生成取提示词第一行
  timestamp: number;
  items: Candidate[];
}

export const absoluteUrl = (url: string): string =>
  /^(https?:|data:|blob:)/i.test(url) ? url : `${AIDRAW_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`;

export const relativeUrl = (url: string): string =>
  url.startsWith(AIDRAW_ORIGIN) ? url.slice(AIDRAW_ORIGIN.length) || '/' : url;

export const isVideo = (url: string): boolean =>
  /^data:video\//i.test(url) || /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(url);

export const pickKey = (messageId: string | null | undefined, url: string): string => `${messageId ?? ''}|${relativeUrl(url)}`;

const firstLine = (text: string, limit = 80): string => {
  const line = text.split('\n').map((part) => part.trim()).find(Boolean) ?? '';
  return line.length > limit ? `${line.slice(0, limit)}…` : line;
};

/**
 * 把一个会话的消息按轮次整理出带结果的助手消息，保持传入的先后顺序。
 * 关卡的提问气泡没有结果，用户的回答气泡是用户消息，都不会被当成候选。
 */
export function buildRounds(messages: ChatMessage[]): CandidateRound[] {
  const users = new Map(messages.filter((message) => message.type === 'user').map((message) => [message.id, message]));
  const rounds: CandidateRound[] = [];
  for (const message of messages) {
    if (message.type !== 'assistant' || !message.images?.length) continue;
    const user = users.get(message.id.replace(/-reply$/, ''));
    rounds.push({
      messageId: message.id,
      text: firstLine(message.content || user?.content || ''),
      timestamp: message.timestamp,
      items: message.images.map((url) => ({
        key: pickKey(message.id, url),
        url: relativeUrl(url),
        src: absoluteUrl(url),
        messageId: message.id,
        video: isVideo(url),
        number: 0,
      })),
    });
  }
  return rounds;
}

/** 关卡建议的轮次排前面（按关卡给的顺序），其余按时间从新到旧；再从 1 开始编号。 */
export function orderRounds(rounds: CandidateRound[], suggested: string[]): CandidateRound[] {
  const unique = [...new Map(rounds.map((round) => [round.messageId, round])).values()];
  const rank = (round: CandidateRound) => {
    const index = suggested.indexOf(round.messageId);
    return index >= 0 ? index : suggested.length;
  };
  const ordered = unique.sort((a, b) => rank(a) - rank(b) || b.timestamp - a.timestamp);
  let number = 0;
  return ordered.map((round) => ({ ...round, items: round.items.map((item) => ({ ...item, number: ++number })) }));
}

export function ruleText(gate: Pick<Gate, 'min_picks' | 'max_picks'>): string {
  const { min_picks: min, max_picks: max } = gate;
  if (max === 0) return '只需确认';
  if (min === 0) return max === 1 ? '可以选 1 个，也可以不选' : `最多选 ${max} 个，也可以不选`;
  if (min === max) return `选 ${max} 个`;
  return `选 ${min}–${max} 个`;
}

/** 点一下候选：已选的取消；只能选 1 个时换成新的；选满了就不动。 */
export function togglePick(selection: string[], key: string, max: number): string[] {
  if (max === 0) return selection;
  if (selection.includes(key)) return selection.filter((item) => item !== key);
  if (max === 1) return [key];
  if (selection.length >= max) return selection;
  return [...selection, key];
}

export function canApprove(gate: Pick<Gate, 'min_picks' | 'max_picks'>, count: number): boolean {
  if (gate.max_picks === 0) return count === 0;
  return count >= gate.min_picks && count <= gate.max_picks;
}

export function approveLabel(gate: Pick<Gate, 'min_picks' | 'max_picks'>, count: number): string {
  if (gate.max_picks === 0) return '确认';
  if (gate.min_picks === 0 && count === 0) return '满意，直接提交';
  return '提交';
}

export const selectionFromPicks = (picks: GatePick[]): string[] => picks.map((pick) => pickKey(pick.message_id, pick.url));

export function picksFromSelection(selection: string[], rounds: CandidateRound[]): GatePick[] {
  const byKey = new Map(rounds.flatMap((round) => round.items).map((item) => [item.key, item]));
  return selection.flatMap((key) => {
    const item = byKey.get(key);
    if (item) return [{ url: item.url, message_id: item.messageId }];
    // 选中的结果不在已加载的轮次里（例如在 ai-draw 网页里选了更早的一张），原样带回去
    const split = key.indexOf('|');
    return split > 0 ? [{ url: key.slice(split + 1), message_id: key.slice(0, split) }] : [];
  });
}

/** 会话标题里的 “Agent · ” 前缀不显示。 */
export const sessionLabel = (title: string | undefined): string => (title ?? '').replace(/^Agent\s*·\s*/, '').trim();

// ---- 项目里的任务日志 art/jobs/<job>.jsonl ----

export interface JobSummary {
  name: string;
  sessionId: string | null;   // 最近用到的会话
  sessions: string[];
  lastTs: number;
  lastEvent: string;
  lastStep: string;
  delivered: string[];        // 交付过的素材 key，新的在前
  latestTaskId: string | null;
  taskStarted: Record<string, number>;   // 生成任务 → 提交时间，用来算已经跑了多久
}

const EVENT_LABELS: Record<string, string> = {
  gen_submitted: '提交生成',
  gen: '生成完成',
  post: '发了素材',
  gate_open: '等你挑选',
  gate_result: '已回答',
  deliver: '已交付',
  rmbg: '抠图',
  cutout_compare: '抠图对比',
  cutout_pick: '选定抠图',
  round_deleted: '删除了一轮',
  session_deleted: '会话已删除',
};

export const eventLabel = (event: string): string => EVENT_LABELS[event] ?? event;

export function parseJobLog(name: string, text: string): JobSummary | null {
  const summary: JobSummary = { name, sessionId: null, sessions: [], lastTs: 0, lastEvent: '', lastStep: '', delivered: [], latestTaskId: null, taskStarted: {} };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;   // 写到一半的行
    }
    const ts = typeof entry.ts === 'string' ? Date.parse(entry.ts) : NaN;
    if (typeof entry.session_id === 'string' && entry.session_id) {
      summary.sessionId = entry.session_id;
      if (!summary.sessions.includes(entry.session_id)) summary.sessions.push(entry.session_id);
    }
    if (typeof entry.task_id === 'string' && entry.task_id) {
      summary.latestTaskId = entry.task_id;
      if (entry.event === 'gen_submitted' && Number.isFinite(ts)) summary.taskStarted[entry.task_id] = ts;
    }
    if (entry.event === 'deliver' && typeof entry.key === 'string') {
      summary.delivered = [entry.key, ...summary.delivered.filter((key) => key !== entry.key)];
    }
    if (typeof entry.event === 'string' && Number.isFinite(ts) && ts >= summary.lastTs) {
      summary.lastTs = ts;
      summary.lastEvent = entry.event;
      summary.lastStep = typeof entry.step === 'string' ? entry.step : '';
    }
  }
  return summary.lastEvent ? summary : null;
}

/** 会话 → 任务名；一个会话出现在多个任务里时，取最近活动的那个。 */
export function sessionJobs(jobs: JobSummary[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const job of [...jobs].sort((a, b) => a.lastTs - b.lastTs)) {
    for (const session of job.sessions) result.set(session, job.name);
  }
  return result;
}

/** 本项目的关卡排前面，同一类里新的在前。 */
export function orderGates(gates: Gate[], projectSessions: Map<string, string>): Gate[] {
  return [...gates].sort((a, b) => {
    const mine = Number(projectSessions.has(b.session_id)) - Number(projectSessions.has(a.session_id));
    return mine || (b.created_at ?? 0) - (a.created_at ?? 0);
  });
}

// ---- 时间 ----

export function ago(ms: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 60) return '刚刚';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

// server/generation/tasks.py 的 Phase
const PHASE_LABELS: Record<string, string> = {
  reserved: '准备中',
  running: '生成中',
  persisting: '保存结果',
};

export const phaseLabel = (phase: string): string => PHASE_LABELS[phase] ?? '生成中';
