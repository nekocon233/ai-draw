// ai-draw 的 agent 接口（docs/agent_bridge.md）。请求都经 OpenChamber 服务器代发，由它附上令牌，页面拿不到令牌。
import { HostRequestError, type HostClient } from '@openchamber/sdk';

export const AIDRAW_ORIGIN = 'https://aidraw.nekocon.cn';

export type GateStatus = 'open' | 'submitted' | 'cancelled';
export type Decision = 'approve' | 'redo';

export interface GatePick {
  url: string;
  message_id?: string | null;
}

export interface Gate {
  gate_id: string;
  session_id: string;
  job: string | null;
  step: string | null;
  question: string;
  min_picks: number;
  max_picks: number;              // 0 表示只需确认
  rounds: string[];               // 建议查看的助手消息 ID（`…-reply`）
  status: GateStatus;
  decision: Decision | null;
  picks: GatePick[];
  note: string;
  cancel_reason: string | null;
  created_at: number | null;      // 毫秒
  updated_at: number | null;
  submitted_at: number | null;
}

export interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: number;
  images?: string[];              // 助手消息的结果地址，图片和视频都在这里
  params?: Record<string, unknown>;
}

export interface SessionInfo {
  id: string;
  title: string;
  updated_at: number;
}

export type Slot =
  | { busy: false }
  | { busy: true; mine: false }
  | {
      busy: true;
      mine: true;
      task_id: string;
      session_id: string;
      message_id: string;
      workflow: string;
      phase: string;
      artifact_count: number;
    };

/** 没拿到 2xx。`status` 为 0 表示请求没到 ai-draw（未连接、超时、OpenChamber 拒绝）。 */
export class AidrawError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
    this.name = 'AidrawError';
  }

  /** 令牌没配或失效。ai-draw 一回 401，OpenChamber 就会删掉保存的令牌，所以两种情况都要重新粘贴。 */
  get disconnected(): boolean {
    return this.code === 'DISCONNECTED' || this.status === 401;
  }
}

const detailOf = (body: string): string | null => {
  try {
    const parsed = JSON.parse(body) as { detail?: unknown };
    if (typeof parsed.detail === 'string') return parsed.detail;
    if (Array.isArray(parsed.detail)) {
      return parsed.detail
        .map((item) => (item && typeof item === 'object' && 'msg' in item ? String((item as { msg: unknown }).msg) : String(item)))
        .join('；');
    }
  } catch {
    // 不是 JSON，用状态码说明
  }
  return null;
};

const hostMessage = (error: unknown): { message: string; code?: string } => {
  if (error instanceof HostRequestError) {
    const messages: Record<string, string> = {
      DISCONNECTED: '还没连接 ai-draw',
      HOST_TIMEOUT: 'ai-draw 20 秒没有回应',
      DISABLED: '扩展在设置里被暂停了',
      RESPONSE_TOO_LARGE: 'ai-draw 返回的数据太大',
    };
    return { message: messages[error.code] ?? error.message, code: error.code };
  }
  return { message: error instanceof Error ? error.message : String(error) };
};

export type AidrawApi = ReturnType<typeof createApi>;

export function createApi(host: Pick<HostClient, 'request'>) {
  const call = async <T>(method: 'GET' | 'POST' | 'PUT', path: string, query?: Record<string, string>, body?: unknown): Promise<T> => {
    let response: { status: number; body: string };
    try {
      response = await host.request({ method, path, query, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (error) {
      const { message, code } = hostMessage(error);
      throw new AidrawError(0, message, code);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new AidrawError(response.status, detailOf(response.body) ?? `ai-draw 返回 HTTP ${response.status}`);
    }
    return (response.body ? JSON.parse(response.body) : null) as T;
  };
  const id = encodeURIComponent;

  return {
    openGates: async (): Promise<Gate[]> =>
      (await call<{ gates: Gate[] }>('GET', '/api/agent/gates', { status: 'open', limit: '50' })).gates,
    round: async (sessionId: string, roundId: string): Promise<ChatMessage[]> =>
      (await call<{ messages: ChatMessage[] }>('GET', `/api/chat/sessions/${id(sessionId)}/rounds/${id(roundId)}`)).messages,
    history: (sessionId: string, limit: number) =>
      call<{ messages: ChatMessage[]; has_more: boolean }>('GET', '/api/chat/history', { session_id: sessionId, limit: String(limit) }),
    sessions: () => call<SessionInfo[]>('GET', '/api/chat/sessions'),
    setPicks: (gateId: string, picks: GatePick[]) =>
      call<Gate>('PUT', `/api/agent/gates/${id(gateId)}/picks`, undefined, { picks }),
    submit: (gateId: string, decision: Decision, picks: GatePick[], note: string) =>
      call<Gate>('POST', `/api/agent/gates/${id(gateId)}/submit`, undefined, { decision, picks, note }),
    slot: () => call<Slot>('GET', '/api/agent/slot'),
  };
}
