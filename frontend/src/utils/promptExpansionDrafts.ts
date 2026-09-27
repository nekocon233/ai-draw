import type { InputGroup } from './composerDrafts';

/** 扩写助手按会话、生图 / 生视频分别保存的草稿：原始描述与最近一次扩写结果，关闭弹窗、应用或刷新后仍保留。 */
export interface PromptExpansionDraft {
  source: string;
  result: string;
  updatedAt: number;
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const PROMPT_EXPANSION_DRAFTS_KEY = 'promptExpansionDrafts';
export const MAX_PROMPT_EXPANSION_DRAFTS = 60;

function isDraft(value: unknown): value is PromptExpansionDraft {
  const draft = value as PromptExpansionDraft | null;
  return !!draft && typeof draft.source === 'string' && typeof draft.result === 'string' && typeof draft.updatedAt === 'number';
}

function readDrafts(storage: DraftStorage): Record<string, PromptExpansionDraft> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(PROMPT_EXPANSION_DRAFTS_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, draft]) => isDraft(draft)));
  } catch {
    return {};
  }
}

const draftKey = (sessionId: string, group: InputGroup) => `${sessionId}:${group}`;

/** Older drafts were keyed by session only; both input types can read one until it is migrated on write. */
export function readExpansionDraft(sessionId: string, group: InputGroup, storage: DraftStorage = localStorage): PromptExpansionDraft | null {
  const drafts = readDrafts(storage);
  return drafts[draftKey(sessionId, group)] ?? drafts[sessionId] ?? null;
}

/** Empty drafts are dropped, and only the most recently edited drafts are kept. */
export function writeExpansionDraft(
  sessionId: string,
  group: InputGroup,
  source: string,
  result: string,
  storage: DraftStorage = localStorage,
  now = Date.now(),
): void {
  const drafts = readDrafts(storage);
  const legacy = drafts[sessionId];
  if (legacy) {
    // 旧草稿留给另一类，这一类清空后也不会再读回旧内容
    delete drafts[sessionId];
    drafts[draftKey(sessionId, group === 'image' ? 'video' : 'image')] ??= legacy;
  }
  const key = draftKey(sessionId, group);
  if (source.trim() || result.trim()) drafts[key] = { source, result, updatedAt: now };
  else delete drafts[key];
  const kept = Object.entries(drafts)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_PROMPT_EXPANSION_DRAFTS);
  try {
    if (kept.length) storage.setItem(PROMPT_EXPANSION_DRAFTS_KEY, JSON.stringify(Object.fromEntries(kept)));
    else storage.removeItem(PROMPT_EXPANSION_DRAFTS_KEY);
  } catch {
    // Full or unavailable storage only loses persistence; the open dialog keeps its text.
  }
}

export function clearExpansionDrafts(storage: DraftStorage = localStorage): void {
  storage.removeItem(PROMPT_EXPANSION_DRAFTS_KEY);
}
