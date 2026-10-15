import { apiService } from '../../api/services';
import { useAppStore } from '../../stores/appStore';
import type { WSMessage } from '../../types/api';
import type { ApiChatMessage, ChatMessage } from '../../types/models';
import { buildMediaSeeds } from '../../utils/generationSeed';
import { isLoggedIn } from '../../utils/helpers';
import { createAgentEventHandler } from './events';
import { useGateStore } from './gateStore';
import { mergeSessionTail, withReplyPlaceholder } from './sessionTail';

const HISTORY_WINDOW = 50;
const running = new Map<string, Promise<void>>();
const rerun = new Set<string>();
// Sessions whose sync waited for this tab's own generation round to finish.
const deferred = new Set<string>();

function toChatMessage(message: ApiChatMessage, sessionId: string): ChatMessage {
  return {
    id: message.id,
    session_id: sessionId,
    type: message.type,
    content: message.content || '',
    images: message.images || [],
    mediaSeeds: buildMediaSeeds(message.images, message.seeds),
    timestamp: message.timestamp,
    params: message.params || undefined,
  };
}

function generatingHere(sessionId: string): boolean {
  const state = useAppStore.getState();
  return state.currentSessionId === sessionId && state.isGenerating
    && state.chatHistory.some(message => message.id === state.currentGeneratingMessageId);
}

async function pullTail(sessionId: string, force: boolean): Promise<void> {
  if (!isLoggedIn() || useAppStore.getState().currentSessionId !== sessionId) return;
  // Progressive results of a round this tab is following would be replaced by an older snapshot.
  if (!force && generatingHere(sessionId)) {
    deferred.add(sessionId);
    return;
  }
  const response = await apiService.getChatHistory(HISTORY_WINDOW, sessionId);
  if (useAppStore.getState().currentSessionId !== sessionId) return;
  if (!force && generatingHere(sessionId)) {
    deferred.add(sessionId);
    return;
  }
  const fetched = (response.messages as ApiChatMessage[]).map(message => toChatMessage(message, sessionId));
  useAppStore.setState(state => {
    if (state.currentSessionId !== sessionId) return {};
    const merged = mergeSessionTail(state.chatHistory, fetched);
    return {
      chatHistory: merged.messages,
      hasEarlierMessages: merged.keptOlder ? state.hasEarlierMessages : response.has_more === true,
    };
  });
}

/** Reload the newest messages of the visible session, keeping older pages; concurrent calls coalesce. */
export function syncSessionTail(sessionId: string, force = false): Promise<void> {
  const current = running.get(sessionId);
  if (current) {
    rerun.add(sessionId);
    return current;
  }
  const task = (async () => {
    try {
      do {
        rerun.delete(sessionId);
        await pullTail(sessionId, force);
      } while (rerun.has(sessionId));
    } catch (error) {
      console.error('同步会话记录失败:', error);
    } finally {
      running.delete(sessionId);
    }
  })();
  running.set(sessionId, task);
  return task;
}

/** Show a round started by an agent (or another tab) so its progress has somewhere to appear. */
export async function adoptRound(sessionId: string, replyId: string): Promise<void> {
  await syncSessionTail(sessionId, true);
  useAppStore.setState(state => state.currentSessionId === sessionId
    ? { chatHistory: withReplyPlaceholder(state.chatHistory, sessionId, replyId, Date.now()) } : {});
}

async function refreshSessionList(): Promise<void> {
  if (!isLoggedIn()) return;
  try {
    await useAppStore.getState().refreshSessionNavigation();
  } catch (error) {
    console.error('刷新会话列表失败:', error);
  }
}

const handleAgentEvent = createAgentEventHandler({
  currentSessionId: () => useAppStore.getState().currentSessionId,
  applyGate: gate => useGateStore.getState().apply(gate),
  reloadGates: () => useGateStore.getState().load(),
  refreshSessions: refreshSessionList,
  syncSession: sessionId => syncSessionTail(sessionId),
});

export function handleAgentBridgeMessage(message: WSMessage): Promise<void> {
  return handleAgentEvent(message).catch(error => console.error('处理 Agent 事件失败:', error));
}

/** Store reactions that need no WebSocket message; returns the cleanup. */
export function startAgentBridge(): () => void {
  const unsubscribe = useAppStore.subscribe((state, previous) => {
    const sessionId = state.currentSessionId;
    if (previous.isGenerating && !state.isGenerating && sessionId && deferred.delete(sessionId)) {
      void syncSessionTail(sessionId);
    }
    if (sessionId && sessionId !== previous.currentSessionId && isLoggedIn()) {
      void useGateStore.getState().load(sessionId);
    }
  });
  return () => {
    unsubscribe();
    deferred.clear();
    rerun.clear();
    useGateStore.getState().reset();
  };
}
