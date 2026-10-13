import type { ChatMessage } from '../../types/models.ts';

/**
 * How a session message written through the agent bridge is shown (server/agent_bridge/gates.py):
 * - `question`: a review gate's question, the agent's bubble on the left;
 * - `answer`: the user's answer to it (what they chose, their note), on the right;
 * - `post-text`: the text of assets the agent posted, shown on the left with the media;
 * - `hidden`: the other half of those rounds, which carries nothing to show.
 */
export type AgentBubbleKind = 'question' | 'answer' | 'post-text' | 'hidden';

type Options = Record<string, string | number | null | undefined>;

export function bubbleOptions(message: ChatMessage): Options {
  return (message.params?.workflowOptions ?? {}) as Options;
}

export function sourceMessageId(replyId: string): string {
  return replyId.endsWith('-reply') ? replyId.slice(0, -'-reply'.length) : replyId;
}

/** Rounds the agent posted before posts were marked: a user message with text but no generation parameters. */
function isUnmarkedPost(message: ChatMessage | undefined): boolean {
  return message?.type === 'user' && !message.params && Boolean(message.content);
}

export function agentBubbleKind(message: ChatMessage, history: readonly ChatMessage[]): AgentBubbleKind | null {
  const workflow = message.params?.workflow;
  if (workflow === 'agent_gate') {
    const kind = bubbleOptions(message).agent_gate;
    if (kind === 'question') return message.type === 'assistant' ? 'question' : 'hidden';
    if (kind === 'answer') return message.type === 'user' ? 'answer' : 'hidden';
    return null;
  }
  if (workflow === 'agent_post') return message.type === 'user' ? 'hidden' : 'post-text';
  if (isUnmarkedPost(message)) return 'hidden';
  if (message.type === 'assistant' && !message.params) {
    const id = sourceMessageId(message.id);
    if (isUnmarkedPost(history.find(item => item.id === id))) return 'post-text';
  }
  return null;
}

/** The text that goes with posted assets (unmarked posts kept it only on their user message). */
export function agentPostText(message: ChatMessage, history: readonly ChatMessage[]): string {
  if (message.content) return message.content;
  const id = sourceMessageId(message.id);
  return history.find(item => item.id === id)?.content ?? '';
}

export function pickHint(options: Options): string {
  const min = Number(options.min_picks ?? 1);
  const max = Number(options.max_picks ?? 1);
  if (max === 0) return '只需确认';
  if (min === max) return `选 ${max} 个`;
  if (min === 0) return `最多选 ${max} 个，也可以不选`;
  return `选 ${min}–${max} 个`;
}

export function questionStatus(options: Options): string {
  if (options.status === 'submitted') return '已回答';
  if (options.status === 'cancelled') return options.cancel_reason ? `已撤销：${options.cancel_reason}` : '已撤销';
  return '等你回答';
}

export interface AnswerReceipt {
  read: boolean;
  text: string;
  hint?: string;
}

/** Whether the agent has read the answer (its `aidraw gate wait` acknowledges it). */
export function answerReceipt(options: Options): AnswerReceipt {
  if (options.acknowledged_at) return { read: true, text: 'Agent 已收到' };
  return {
    read: false,
    text: '等待 Agent 读取',
    hint: '一直没有变成“Agent 已收到”，说明 agent 没在等这个回答：回到和它的对话里说一声。',
  };
}

export function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
}
