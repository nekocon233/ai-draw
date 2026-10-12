import type { ChatMessage } from '../../types/models.ts';

export interface TailMerge {
  messages: ChatMessage[];
  /** Older pages the user had loaded were kept, so the existing "has earlier" state still applies. */
  keptOlder: boolean;
}

/** Replace the newest window with fresh server data while keeping the older pages already loaded. */
export function mergeSessionTail(local: readonly ChatMessage[], fetched: readonly ChatMessage[]): TailMerge {
  if (fetched.length === 0) return { messages: [], keptOlder: false };
  const fetchedIds = new Set(fetched.map(message => message.id));
  const anchor = local.findIndex(message => message.id === fetched[0].id);
  let older: ChatMessage[] = [];
  if (anchor >= 0) {
    older = local.slice(0, anchor);
  } else if (local.some(message => fetchedIds.has(message.id))) {
    older = local.filter(message => message.timestamp < fetched[0].timestamp);
  }
  // Without any overlap the window moved past everything loaded; older pages are fetched again on scroll.
  older = older.filter(message => !fetchedIds.has(message.id));
  return { messages: [...older, ...fetched], keptOlder: older.length > 0 };
}

/** Give a round started elsewhere a reply to show progress in, right after its user message. */
export function withReplyPlaceholder(
  history: readonly ChatMessage[],
  sessionId: string,
  replyId: string,
  now: number,
): ChatMessage[] {
  if (history.some(message => message.id === replyId)) return [...history];
  const sourceId = replyId.endsWith('-reply') ? replyId.slice(0, -'-reply'.length) : null;
  const sourceIndex = sourceId ? history.findIndex(message => message.id === sourceId) : -1;
  const source = sourceIndex >= 0 ? history[sourceIndex] : undefined;
  const placeholder: ChatMessage = {
    id: replyId,
    session_id: sessionId,
    type: 'assistant',
    content: '',
    images: [{ loading: true }],
    timestamp: source?.timestamp ?? now,
    params: source?.params ? { ...source.params } : undefined,
  };
  if (sourceIndex < 0) return [...history, placeholder];
  return [...history.slice(0, sourceIndex + 1), placeholder, ...history.slice(sourceIndex + 1)];
}
