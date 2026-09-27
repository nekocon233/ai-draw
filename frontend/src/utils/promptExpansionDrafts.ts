/** 扩写助手按会话保存的草稿：原始描述与最近一次扩写结果，关闭弹窗、应用或刷新后仍保留。 */
export interface PromptExpansionDraft {
  source: string;
  result: string;
  updatedAt: number;
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const PROMPT_EXPANSION_DRAFTS_KEY = 'promptExpansionDrafts';
export const MAX_PROMPT_EXPANSION_DRAFTS = 30;

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

export function readExpansionDraft(sessionId: string, storage: DraftStorage = localStorage): PromptExpansionDraft | null {
  return readDrafts(storage)[sessionId] ?? null;
}

/** Empty drafts are dropped, and only the most recently edited sessions are kept. */
export function writeExpansionDraft(
  sessionId: string,
  source: string,
  result: string,
  storage: DraftStorage = localStorage,
  now = Date.now(),
): void {
  const drafts = readDrafts(storage);
  if (source.trim() || result.trim()) drafts[sessionId] = { source, result, updatedAt: now };
  else delete drafts[sessionId];
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
