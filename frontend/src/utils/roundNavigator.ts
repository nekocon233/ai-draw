import type { SessionOutlineRound } from '../types/api';
import type { ChatMessage } from '../types/models';
import type { EarlierMessagesResult } from '../stores/appStore';
import { isVideoUrl } from './media.ts';

export const NAVIGATOR_MEDIA_LIMIT = 4;

export interface NavigatorMedia {
  url: string;
  video: boolean;
}

export interface NavigatorRound {
  id: string;              // 用户消息 ID，即页面上的 data-message-id
  timestamp: number;
  text: string;
  presetTitle: string | null;
  workflow: string | null;
  media: NavigatorMedia[]; // 预览用的前几个结果
  mediaCount: number;
  generating: boolean;
  loaded: boolean;         // 是否已在页面上
}

const toMedia = (urls: string[]): NavigatorMedia[] =>
  urls.slice(0, NAVIGATOR_MEDIA_LIMIT).map(url => ({ url, video: isVideoUrl(url) }));

/**
 * 导航条的轮次：已加载的直接取实时聊天记录，尚未加载的旧轮次取 outline。
 * 已加载部分总是会话末尾的一段；分页边界若只加载到某轮的助手回复，这一轮仍算未加载，跳转时再多加载一页。
 */
export function buildNavigatorRounds(
  history: ChatMessage[],
  outline: SessionOutlineRound[] | null,
  generatingMessageId: string | null,
): NavigatorRound[] {
  const replies = new Map(history.filter(message => message.type === 'assistant').map(message => [message.id, message]));
  const loaded = history.filter(message => message.type === 'user').map((message): NavigatorRound => {
    const replyId = `${message.id}-reply`;
    const results = replies.get(replyId)?.images ?? [];
    const urls = results.filter((image): image is string => typeof image === 'string');
    return {
      id: message.id,
      timestamp: message.timestamp,
      text: message.content,
      presetTitle: message.params?.promptPreset?.title ?? null,
      workflow: message.params?.workflow ?? null,
      media: toMedia(urls),
      mediaCount: urls.length,
      generating: replyId === generatingMessageId || results.length > urls.length,
      loaded: true,
    };
  });
  if (!outline?.length || history.length === 0) return loaded;

  const loadedIds = new Set(loaded.map(round => round.id));
  const oldestLoaded = history[0].timestamp;
  const earlier = outline
    .filter(round => !loadedIds.has(round.id) && round.timestamp <= oldestLoaded)
    .map((round): NavigatorRound => ({
      id: round.id,
      timestamp: round.timestamp,
      text: round.content,
      presetTitle: round.preset_title ?? null,
      workflow: round.workflow ?? null,
      media: toMedia(round.media),
      mediaCount: Math.max(round.media_count, round.media.length),
      generating: false,
      loaded: false,
    }));
  return [...earlier, ...loaded];
}

export type LocateResult = 'found' | 'missing' | 'error' | 'cancelled';

export interface LocateOptions {
  find: () => boolean;
  hasMore: () => boolean;
  load: () => Promise<EarlierMessagesResult>;
  /** 用户滚动、再次跳转或切换会话后返回 false */
  alive: () => boolean;
  /** 等新消息渲染到页面上 */
  settle: () => Promise<void>;
  maxPages?: number;
}

/** 逐页加载更早记录，直到目标轮次出现在页面上。 */
export async function loadUntilFound({ find, hasMore, load, alive, settle, maxPages = 20 }: LocateOptions): Promise<LocateResult> {
  for (let pages = 0; ; pages += 1) {
    if (!alive()) return 'cancelled';
    if (find()) return 'found';
    if (!hasMore() || pages >= maxPages) return 'missing';
    const result = await load();
    if (!alive() || result === 'stale') return 'cancelled';
    if (result === 'error') return 'error';
    await settle();
  }
}
