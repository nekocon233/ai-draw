import type { StateCreator } from 'zustand';
import type { AppState } from '../../stores/appStore';
import type { ChatSession, ChatSessionGroup, SessionGroupUpdate } from '../../types/models';
import { apiService } from '../../api/services';
import { isLoggedIn, saveGuestSessions } from '../../utils/helpers';

export interface SessionGroupsSlice {
  sessionGroups: ChatSessionGroup[];
  ungroupedCollapsed: boolean;
  sessionNavigationLoading: boolean;
  sessionNavigationPending: number;
  sessionNavigationError: string | null;
  refreshSessionNavigation: () => Promise<{ sessions: ChatSession[]; currentSessionId?: string } | null>;
  createSessionGroup: (name: string) => Promise<ChatSessionGroup | null>;
  updateSessionGroup: (groupId: number, update: SessionGroupUpdate) => Promise<boolean>;
  deleteSessionGroup: (groupId: number) => Promise<boolean>;
  moveSessionToGroup: (sessionId: string, groupId: number | null) => Promise<boolean>;
  setUngroupedCollapsed: (collapsed: boolean) => Promise<boolean>;
  setSessionPinned: (sessionId: string, pinned: boolean) => Promise<void>;
  clearSessionNavigationError: () => void;
  beginSessionNavigationChange: () => () => void;
  resetSessionNavigation: () => void;
}

export const createSessionGroupsSlice: StateCreator<AppState, [], [], SessionGroupsSlice> = (set, get) => {
  let epoch = 0;
  let revision = 0;
  let read = 0;
  let tail: Promise<unknown> = Promise.resolve();
  const externalChanges = new Set<Promise<void>>();

  // 同一账号的整理操作串行执行；读取不能覆盖读请求之后发生的整理或新建。
  const mutate = <T>(work: (active: () => boolean) => Promise<T>): Promise<T | null> => {
    const account = epoch;
    revision += 1;
    set(state => ({ sessionNavigationPending: state.sessionNavigationPending + 1, sessionNavigationError: null }));
    const active = () => account === epoch;
    const result = tail.then(() => active() ? work(active) : null).catch(error => {
      if (active()) {
        const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
          ? error.message : '保存分组失败，请重试';
        set({ sessionNavigationError: message });
        console.error('更新会话导航失败:', error);
      }
      return null;
    }).finally(() => {
      if (active()) {
        revision += 1;
        set(state => ({ sessionNavigationPending: state.sessionNavigationPending - 1 }));
      }
    });
    tail = result;
    return result;
  };

  return {
    sessionGroups: [], ungroupedCollapsed: false,
    sessionNavigationLoading: false, sessionNavigationPending: 0, sessionNavigationError: null,
    clearSessionNavigationError: () => set({ sessionNavigationError: null }),
    beginSessionNavigationChange: () => {
      const account = epoch;
      let finished = false;
      let release!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      externalChanges.add(pending);
      revision += 1;
      set(state => ({ sessionNavigationPending: state.sessionNavigationPending + 1 }));
      return () => {
        if (finished) return;
        finished = true; externalChanges.delete(pending); release();
        if (account !== epoch) return;
        revision += 1;
        set(state => ({ sessionNavigationPending: state.sessionNavigationPending - 1 }));
      };
    },
    resetSessionNavigation: () => {
      epoch += 1; revision += 1; read += 1; tail = Promise.resolve();
      externalChanges.clear();
      set({ sessionGroups: [], ungroupedCollapsed: false, sessionNavigationPending: 0,
        sessionNavigationLoading: false, sessionNavigationError: null });
    },
    refreshSessionNavigation: async () => {
      const account = epoch, request = ++read;
      const active = () => account === epoch && request === read;
      set({ sessionNavigationLoading: true });
      try {
        while (active()) {
          await Promise.all([tail, ...externalChanges]);
          if (!active()) return null;
          const version = revision;
          const [sessions, sessionGroups, config] = await Promise.all([
            apiService.getSessions(), apiService.getSessionGroups(), apiService.getUserConfig(),
          ]);
          if (!active()) return null;
          if (version !== revision || get().sessionNavigationPending) continue;
          set({ sessions, sessionGroups, ungroupedCollapsed: config.ungrouped_collapsed ?? false, sessionNavigationError: null });
          return { sessions, currentSessionId: config.current_session_id };
        }
        return null;
      } catch (error) {
        if (active()) set({ sessionNavigationError: '会话分组加载失败，请重试' });
        throw error;
      } finally {
        if (active()) set({ sessionNavigationLoading: false });
      }
    },
    createSessionGroup: name => mutate(async active => {
      const group = await apiService.createSessionGroup(name);
      if (!active()) return null;
      set(state => ({ sessionGroups: [...state.sessionGroups, group] }));
      return group;
    }),
    updateSessionGroup: async (groupId, update) => (await mutate(async active => {
      const previous = get().sessionGroups.find(group => group.id === groupId);
      if (!previous) return false;
      set(state => ({ sessionGroups: state.sessionGroups.map(group => group.id === groupId ? { ...group, ...update } : group) }));
      try {
        const saved = await apiService.updateSessionGroup(groupId, update);
        if (active()) set(state => ({ sessionGroups: state.sessionGroups.map(group => group.id === groupId ? saved : group) }));
        return active();
      } catch (error) {
        if (active()) set(state => ({ sessionGroups: state.sessionGroups.map(group => group.id === groupId ? previous : group) }));
        throw error;
      }
    })) ?? false,
    deleteSessionGroup: async groupId => (await mutate(async active => {
      await apiService.deleteSessionGroup(groupId);
      if (!active()) return false;
      set(state => ({
        sessionGroups: state.sessionGroups.filter(group => group.id !== groupId),
        sessions: state.sessions.map(session => session.group_id === groupId ? { ...session, group_id: null } : session),
      }));
      return true;
    })) ?? false,
    moveSessionToGroup: async (sessionId, groupId) => (await mutate(async active => {
      const previous = get().sessions.find(session => session.id === sessionId);
      if (!previous || (groupId !== null && !get().sessionGroups.some(group => group.id === groupId))) return false;
      const wasCollapsed = groupId === null ? get().ungroupedCollapsed : get().sessionGroups.find(group => group.id === groupId)!.is_collapsed;
      set(state => ({
        sessions: state.sessions.map(session => session.id === sessionId ? { ...session, group_id: groupId } : session),
        ...(groupId === null ? { ungroupedCollapsed: false } : {
          sessionGroups: state.sessionGroups.map(group => group.id === groupId ? { ...group, is_collapsed: false } : group),
        }),
      }));
      try {
        await apiService.moveSessionToGroup(sessionId, groupId);
        return active();
      } catch (error) {
        if (active()) set(state => ({
          sessions: state.sessions.map(session => session.id === sessionId ? { ...session, group_id: previous.group_id ?? null } : session),
          ...(groupId === null ? { ungroupedCollapsed: wasCollapsed } : {
            sessionGroups: state.sessionGroups.map(group => group.id === groupId ? { ...group, is_collapsed: wasCollapsed } : group),
          }),
        }));
        throw error;
      }
    })) ?? false,
    setUngroupedCollapsed: async collapsed => (await mutate(async active => {
      const previous = get().ungroupedCollapsed;
      set({ ungroupedCollapsed: collapsed });
      try {
        await apiService.updateUserConfig({ ungrouped_collapsed: collapsed });
        return active();
      } catch (error) {
        if (active()) set({ ungroupedCollapsed: previous });
        throw error;
      }
    })) ?? false,
    setSessionPinned: async (sessionId, pinned) => {
      await mutate(async active => {
        const previous = get().sessions.find(session => session.id === sessionId)?.is_pinned ?? false;
        set(state => ({ sessions: state.sessions.map(session => session.id === sessionId ? { ...session, is_pinned: pinned } : session) }));
        if (!isLoggedIn()) { saveGuestSessions(get().sessions); return; }
        try { await apiService.updateSessionPin(sessionId, pinned); }
        catch (error) {
          if (active()) set(state => ({ sessions: state.sessions.map(session => session.id === sessionId ? { ...session, is_pinned: previous } : session) }));
          throw error;
        }
      });
    },
  };
};
