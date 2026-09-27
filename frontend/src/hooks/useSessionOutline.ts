/**
 * 会话轮次摘要（结果区导航条用）
 *
 * 只在会话还有未加载的更早记录时请求；每次进入会话都重新请求，切换会话后旧结果作废。
 */
import { useCallback, useEffect, useState } from 'react';
import { apiService } from '../api/services';
import type { SessionOutlineRound } from '../types/api';

interface OutlineEntry {
  sessionId: string;
  rounds: SessionOutlineRound[];
}

export function useSessionOutline(sessionId: string | null, enabled: boolean) {
  const [entry, setEntry] = useState<OutlineEntry | null>(null);

  useEffect(() => {
    if (!sessionId || !enabled) return;
    let cancelled = false;
    apiService.getSessionOutline(sessionId)
      .then(({ rounds }) => { if (!cancelled) setEntry({ sessionId, rounds }); })
      .catch(error => console.error('加载对话导航失败:', error));
    return () => { cancelled = true; };
  }, [sessionId, enabled]);

  // 删掉的轮次立即剔除，否则删掉最早的已加载轮次后，它会被当成尚未加载的旧轮次
  const forget = useCallback((roundId: string) => {
    setEntry(current => current && { ...current, rounds: current.rounds.filter(round => round.id !== roundId) });
  }, []);

  const refresh = useCallback(async (): Promise<SessionOutlineRound[] | null> => {
    if (!sessionId) return null;
    try {
      const { rounds } = await apiService.getSessionOutline(sessionId);
      // 期间已切到别的会话并拿到了它的摘要时，不覆盖
      setEntry(current => (current && current.sessionId !== sessionId ? current : { sessionId, rounds }));
      return rounds;
    } catch (error) {
      console.error('加载对话导航失败:', error);
      return null;
    }
  }, [sessionId]);

  return {
    rounds: entry?.sessionId === sessionId ? entry.rounds : null,
    forget,
    refresh,
  };
}
