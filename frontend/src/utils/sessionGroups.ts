import type { ChatSession, ChatSessionGroup } from '../types/models';

export interface SessionSection {
  id: number | null;
  name: string;
  is_pinned: boolean;
  is_collapsed: boolean;
  sessions: ChatSession[];
}

/** 固定项目顺序，活动只影响组内排序；旧会话和已删除分组的会话落到未分组。 */
export function buildSessionSections(
  sessions: ChatSession[], groups: ChatSessionGroup[], ungroupedCollapsed: boolean,
): SessionSection[] {
  const sections: SessionSection[] = [...groups]
    .sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || a.created_at - b.created_at || a.id - b.id)
    .map(group => ({ ...group, sessions: [] }));
  const ungrouped: SessionSection = { id: null, name: '未分组', is_pinned: false, is_collapsed: ungroupedCollapsed, sessions: [] };
  const byId = new Map(sections.map(section => [section.id, section]));
  for (const session of sessions) (byId.get(session.group_id ?? null) ?? ungrouped).sessions.push(session);
  sections.push(ungrouped);
  for (const section of sections) section.sessions.sort((a, b) =>
    Number(b.is_pinned) - Number(a.is_pinned) || b.updated_at - a.updated_at || a.id.localeCompare(b.id));
  return sections;
}
