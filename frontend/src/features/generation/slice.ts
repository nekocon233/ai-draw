import type { StateCreator } from 'zustand';
import type { AppState } from '../../stores/appStore';
import type { ApiChatMessage } from '../../types/models';
import { apiService } from '../../api/services';
import { isLoggedIn } from '../../utils/helpers';
import { buildMediaSeeds } from '../../utils/generationSeed';

export interface GenerationSlice {
  generationProgress: string;
  setGenerationProgress: (progress: string) => void;
  isGenerating: boolean;
  currentGeneratingMessageId: string | null;
  currentGenerationTaskId: string | null;
  generationRevision: number;
  startGeneration: (messageId: string, taskId: string | null) => void;
  finishGeneration: () => void;
  retainGenerationImages: (messageId: string) => void;
  refreshGenerationRound: (sessionId: string, messageId: string) => Promise<string[]>;
  stopGeneration: () => Promise<void>;
}

export const createGenerationSlice: StateCreator<AppState, [], [], GenerationSlice> = (set, get) => ({
  generationProgress: '',
  setGenerationProgress: generationProgress => set({ generationProgress }),
  isGenerating: false,
  currentGeneratingMessageId: null,
  currentGenerationTaskId: null,
  generationRevision: 0,
  startGeneration: (messageId, taskId) => set(state => ({
    generationProgress: '正在提交生成任务…',
    isGenerating: true,
    currentGeneratingMessageId: messageId,
    currentGenerationTaskId: taskId,
    generationRevision: state.generationRevision + 1,
  })),
  finishGeneration: () => {
    const state = get();
    if (!state.isGenerating && !state.currentGeneratingMessageId && !state.currentGenerationTaskId) return;
    set({
      generationProgress: '',
      isGenerating: false,
      currentGeneratingMessageId: null,
      currentGenerationTaskId: null,
      generationRevision: state.generationRevision + 1,
    });
  },
  retainGenerationImages: messageId => {
    const message = get().chatHistory.find(item => item.id === messageId);
    const images = (message?.images ?? []).filter((image): image is string => typeof image === 'string');
    get().updateChatImages(messageId, images, false);
  },
  refreshGenerationRound: async (sessionId, messageId) => {
    const revision = get().generationRevision;
    try {
      const response = await apiService.getMessageRound(sessionId, messageId);
      if (get().currentSessionId !== sessionId || get().generationRevision !== revision) return [];
      const round = (response.messages as ApiChatMessage[]).map(item => ({
        ...item, session_id: sessionId, content: item.content || '', images: item.images || [],
        mediaSeeds: buildMediaSeeds(item.images, item.seeds),
      }));
      const byId = new Map(round.map(item => [item.id, item]));
      set(state => ({ chatHistory: state.chatHistory.map(item => byId.get(item.id) ?? item) }));
      return (byId.get(messageId)?.images ?? []).filter((image): image is string => typeof image === 'string');
    } catch (error) {
      console.error('刷新任务轮次失败:', error);
      return [];
    }
  },
  stopGeneration: async () => {
    const before = get();
    const taskId = before.currentGenerationTaskId;
    const messageId = before.currentGeneratingMessageId;
    const taskMessage = before.chatHistory.find(item => item.id === messageId);
    await apiService.stopGeneration(taskId ?? undefined);
    const current = get();
    if ((current.currentGenerationTaskId && current.currentGenerationTaskId !== taskId)
      || current.generationRevision > before.generationRevision + 1) return;
    if (messageId) current.retainGenerationImages(messageId);
    current.finishGeneration();
    set({ loading: false });
    if (isLoggedIn() && messageId && taskMessage?.session_id === get().currentSessionId) {
      await get().refreshGenerationRound(taskMessage.session_id, messageId);
    }
  },
});
