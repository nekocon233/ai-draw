import { useEffect } from 'react';
import type { MessageInstance } from 'antd/es/message/interface';
import { wsManager } from '../../api/websocket';
import { apiService } from '../../api/services';
import { useAppStore } from '../../stores/appStore';
import { isLoggedIn } from '../../utils/helpers';
import { createGenerationEventHandler } from './events';

export function useGenerationConnection(messageApi: MessageInstance) {
  useEffect(() => {
    let disposed = false;
    const handleMessage = createGenerationEventHandler({
      getState: useAppStore.getState,
      progress: text => useAppStore.getState().setGenerationProgress(text),
      start: (messageId, taskId) => useAppStore.getState().startGeneration(messageId, taskId),
      finish: () => useAppStore.getState().finishGeneration(),
      retainImages: messageId => useAppStore.getState().retainGenerationImages(messageId),
      appendMedia: (messageId, image, index) => useAppStore.getState().appendChatMedia(messageId, image, index),
      refreshRound: async (sessionId, messageId) => {
        if (disposed) return [];
        const images = await useAppStore.getState().refreshGenerationRound(sessionId, messageId);
        return disposed ? [] : images;
      },
      notify: (kind, text) => { if (!disposed) void messageApi[kind](text); },
    });

    const unsubscribe = wsManager.subscribe(message => {
      if (disposed) return;
      if (message.type === 'state_change') {
        if (message.field === 'is_service_available' && typeof message.value === 'boolean') {
          useAppStore.getState().setServiceStatus({ available: message.value });
        } else if (message.field === 'is_generating_prompt' && typeof message.value === 'boolean') {
          useAppStore.setState({ isGeneratingPrompt: message.value });
        }
      } else if (message.type === 'initial_state' && message.data) {
        useAppStore.setState({ isGeneratingPrompt: message.data.is_generating_prompt === true });
      }
      void handleMessage(message);
    });

    const loadData = async () => {
      const store = useAppStore.getState();
      await store.loadDefaultConfig();
      await store.loadAvailableWorkflows();
      if (isLoggedIn()) await store.loadUserConfig();
      await store.loadSessions();
      if (!disposed && isLoggedIn()) {
        await store.loadPromptPresets().catch(error => console.error('加载默认提示词预设失败:', error));
      }
      if (!disposed && isLoggedIn()) wsManager.connect();
    };
    void loadData().catch(error => { if (!disposed) useAppStore.getState().setError(String(error)); });
    void apiService.getServiceStatus()
      .then(status => { if (!disposed) useAppStore.getState().setServiceStatus(status); })
      .catch(error => { if (!disposed) useAppStore.getState().setError(String(error)); });

    return () => {
      disposed = true;
      unsubscribe();
      wsManager.disconnect();
    };
  }, [messageApi]);
}
