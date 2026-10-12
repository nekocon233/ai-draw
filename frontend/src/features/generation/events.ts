import type { LastTaskInfo, WSMessage } from '../../types/api';
import { readMediaSeed } from '../../utils/generationSeed.ts';

export interface GenerationState {
  isGenerating: boolean;
  currentGeneratingMessageId: string | null;
  currentGenerationTaskId: string | null;
  generationRevision: number;
  currentSessionId: string | null;
}

export interface GenerationEventPort {
  progress?(text: string): void;
  getState(): GenerationState;
  start(messageId: string, taskId: string | null): void;
  finish(): void;
  retainImages(messageId: string): void;
  appendMedia(messageId: string, image: string, index: number, seed: number | null): void;
  refreshRound(sessionId: string, messageId: string): Promise<string[]>;
  notify(kind: 'info' | 'success' | 'warning' | 'error', text: string): void;
  /** Bring a round started elsewhere (an agent or another tab) into the visible session before following it. */
  adoptRound?(sessionId: string, messageId: string): Promise<void>;
  /** Reload the visible session after a task this tab was not following has ended. */
  syncSession?(sessionId: string): Promise<void>;
}

const TERMINAL_FIELDS = new Set(['error', 'generation_cancelled']);

export function matchesGeneration(message: WSMessage, state: GenerationState): boolean {
  if (!state.currentGeneratingMessageId) return false;
  if (message.message_id && message.message_id !== state.currentGeneratingMessageId) return false;
  if (message.task_id) return message.task_id === state.currentGenerationTaskId;
  if (state.currentGenerationTaskId) return false;
  return message.message_id === state.currentGeneratingMessageId;
}

function completionText(images: string[], recovered = false): string {
  const isVideo = images.some(url => /\.(mp4|webm)$/i.test(url) || url.includes('/video/'));
  return `生成${recovered ? '已完成（连接恢复）' : '完成！'}，共 ${images.length} 个${isVideo ? '视频' : '图片'}`;
}

export function createGenerationEventHandler(port: GenerationEventPort) {
  const refresh = async (sessionId: string, messageId: string, recovered: boolean, task?: LastTaskInfo) => {
    const revision = port.getState().generationRevision;
    const images = await port.refreshRound(sessionId, messageId);
    if (port.getState().generationRevision !== revision) return;
    if (task?.phase === 'cancelled') {
      port.notify('info', '生成已停止，已完成的结果已保留');
    } else if (task?.status === 'error') {
      port.notify('error', '上次生成失败: ' + (task.error || '未知错误'));
    } else if (images.length > 0) {
      port.notify('success', completionText(images, recovered));
    }
  };

  // Same-account tasks started elsewhere are followed live while this tab is idle, as a reconnect would.
  const followForeignTask = async (message: WSMessage, state: GenerationState): Promise<void> => {
    const sessionId = message.session_id ?? null;
    if (message.field === 'is_generating' && message.value === true && message.message_id && message.task_id) {
      if (state.isGenerating || state.currentGeneratingMessageId) return;
      if (sessionId && sessionId === state.currentSessionId) await port.adoptRound?.(sessionId, message.message_id);
      const latest = port.getState();
      if (latest.isGenerating || latest.currentGeneratingMessageId) return;
      port.start(message.message_id, message.task_id);
      return;
    }
    const ended = TERMINAL_FIELDS.has(message.field ?? '') || (message.field === 'is_generating' && message.value === false);
    if (ended && message.task_id && sessionId && sessionId === state.currentSessionId) {
      await port.syncSession?.(sessionId);
    }
  };

  return async (message: WSMessage): Promise<void> => {
    if (message.type === 'initial_state' && message.data) {
      const state = port.getState();
      const lastTask = message.data.last_task;
      if (message.data.is_generating && lastTask?.status === 'running' && lastTask.message_id) {
        if (state.currentGeneratingMessageId !== lastTask.message_id
          || state.currentGenerationTaskId !== (lastTask.task_id ?? null)) {
          port.start(lastTask.message_id, lastTask.task_id ?? null);
          port.notify('info', '检测到正在进行的生成任务，已恢复显示');
        }
        if (lastTask.session_id && lastTask.session_id === state.currentSessionId) {
          await port.refreshRound(lastTask.session_id, lastTask.message_id);
        }
        return;
      }
      if (lastTask?.message_id && lastTask.session_id
        && (lastTask.status === 'completed' || lastTask.status === 'error')) {
        // A delayed reconnect snapshot must not clear a newer local submission.
        if (state.isGenerating && state.currentGenerationTaskId
          && lastTask.task_id !== state.currentGenerationTaskId) return;
        port.finish();
        if (lastTask.session_id === state.currentSessionId) {
          await refresh(lastTask.session_id, lastTask.message_id, true, lastTask);
        } else if (lastTask.status === 'error' && lastTask.phase !== 'cancelled') {
          port.notify('error', '上次生成失败: ' + (lastTask.error || '未知错误'));
        }
        return;
      }
      if (!message.data.is_generating && (state.isGenerating || state.currentGeneratingMessageId)) {
        if (state.currentGeneratingMessageId) port.retainImages(state.currentGeneratingMessageId);
        port.finish();
        port.notify('warning', '连接已恢复，生成任务状态已重置');
      }
      return;
    }

    const state = port.getState();
    if (message.type !== 'state_change') return;
    if (!matchesGeneration(message, state)) {
      await followForeignTask(message, state);
      return;
    }
    const messageId = state.currentGeneratingMessageId!;
    if (message.field === 'generation_progress' && typeof message.value === 'string') {
      port.progress?.(message.value);
    }
    if (message.field === 'generation_cancelled') {
      port.retainImages(messageId);
      port.finish();
      const revision = port.getState().generationRevision;
      if (message.session_id) await port.refreshRound(message.session_id, messageId);
      if (port.getState().generationRevision === revision) {
        port.notify('info', typeof message.value === 'string' ? message.value : '生成已停止，已完成的结果已保留');
      }
    } else if (message.field === 'is_generating' && message.value === false) {
      port.finish();
      if (message.session_id) await refresh(message.session_id, messageId, false);
    } else if (message.field === 'error' && typeof message.value === 'string' && message.value) {
      port.finish();
      port.notify('error', '生成失败: ' + message.value);
      if (message.session_id) await port.refreshRound(message.session_id, messageId);
    } else if (message.field === 'media_generated' && typeof message.value === 'object' && message.value) {
      const value = message.value as Record<string, unknown>;
      if (typeof value.image === 'string' && value.image && typeof value.index === 'number'
        && Number.isInteger(value.index) && value.index >= 0) {
        port.appendMedia(messageId, value.image, value.index, readMediaSeed(value.seed));
      }
    }
  };
}
