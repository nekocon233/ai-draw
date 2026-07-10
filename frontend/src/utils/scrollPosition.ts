// 按会话持久化聊天列表的滚动位置（localStorage）
// 结构：{ [sessionId]: { scrollTop, messageId, offset, savedAt } }
const KEY = 'ai-draw:scroll-positions';

export interface StoredScrollPosition {
  scrollTop: number;
  messageId?: string;
  offset?: number;
  savedAt?: number;
}

type ScrollPositionMap = Record<string, StoredScrollPosition | number>;

function readAll(): ScrollPositionMap {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function writeAll(map: ScrollPositionMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* 忽略配额/隐私模式错误 */
  }
}

export function getScrollPosition(sessionId: string): StoredScrollPosition | null {
  const v = readAll()[sessionId];
  if (typeof v === 'number') {
    return isFinite(v) && v >= 0 ? { scrollTop: v } : null;
  }
  if (!v || typeof v !== 'object') return null;
  if (typeof v.scrollTop !== 'number' || !isFinite(v.scrollTop) || v.scrollTop < 0) return null;
  return v;
}

export function setScrollPosition(sessionId: string, position: StoredScrollPosition) {
  const all = readAll();
  all[sessionId] = position;
  writeAll(all);
}

export function clearScrollPosition(sessionId: string) {
  const all = readAll();
  if (sessionId in all) {
    delete all[sessionId];
    writeAll(all);
  }
}
