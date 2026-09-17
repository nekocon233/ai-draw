import { lazy, Suspense, useEffect, useState } from 'react';
import { Layout, ConfigProvider, theme, App as AntApp, message } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import ChatInput from './components/ChatInput';
import StatusBar from './components/StatusBar';
import ChatSessionSidebar from './components/ChatSessionSidebar';
import LoginModal from './components/LoginModal';
import { wsManager } from './api/websocket';
import { apiService } from './api/services';
import { useAppStore } from './stores/appStore';
import { useShallow } from 'zustand/react/shallow';
import { AUTH_REQUIRED_EVENT, clearAccessToken, getAccessTokenExpiry, isLoggedIn } from './utils/helpers';
import { WS_MESSAGE_TYPES, STATE_FIELDS } from './utils/constants';
import type { LastTaskInfo } from './types/api';
import './App.css';

const ResultGrid = lazy(() => import('./components/ResultGrid'));

type ApiChatMessage = {
  id: string;
  type: 'user' | 'assistant';
  content?: string;
  images?: Array<string | { loading: true }>;
  timestamp: number;
  params?: import('./types/models').ChatMessage['params'];
};

function AppContent() {
  const { setServiceStatus, setError, chatHistory, loadUserConfig, loadSessions } = useAppStore(useShallow(state => ({
    setServiceStatus: state.setServiceStatus,
    setError: state.setError,
    chatHistory: state.chatHistory,
    loadUserConfig: state.loadUserConfig,
    loadSessions: state.loadSessions,
  })));
  const [isDark, setIsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [messageApi, contextHolder] = message.useMessage();
  const [forceLoginOpen, setForceLoginOpen] = useState(!isLoggedIn());

  // 主题检测
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = (dark: boolean) => {
      setIsDark(dark);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };

    applyTheme(mediaQuery.matches);

    const handleThemeChange = (e: MediaQueryListEvent) => {
      applyTheme(e.matches);
    };

    mediaQuery.addEventListener('change', handleThemeChange);
    return () => {
      mediaQuery.removeEventListener('change', handleThemeChange);
    };
  }, []);

  useEffect(() => {
    const expiresAt = getAccessTokenExpiry();
    if (expiresAt === null) return;
    const delay = expiresAt - Date.now();
    if (delay <= 0) {
      clearAccessToken();
      return;
    }
    const timer = window.setTimeout(clearAccessToken, delay);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const lockApplication = () => {
      setForceLoginOpen(true);
      wsManager.disconnect();
      useAppStore.setState({
        isGenerating: false,
        currentGeneratingMessageId: null,
        currentGenerationTaskId: null,
      });
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'access_token' && !event.newValue) lockApplication();
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, lockApplication);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(AUTH_REQUIRED_EVENT, lockApplication);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // 数据加载和 WebSocket 连接
  useEffect(() => {
    let disposed = false;

    const loadData = async () => {
      await useAppStore.getState().loadDefaultConfig();
      await useAppStore.getState().loadAvailableWorkflows();
      if (isLoggedIn()) await loadUserConfig();
      await loadSessions();
    };

    const refreshMessageRound = async (sessionId: string, assistantMessageId: string) => {
      try {
        const response = await apiService.getMessageRound(sessionId, assistantMessageId);
        if (disposed || useAppStore.getState().currentSessionId !== sessionId) return [];
        const round = (response.messages as ApiChatMessage[]).map(item => ({
          id: item.id,
          session_id: sessionId,
          type: item.type,
          content: item.content || '',
          images: item.images || [],
          timestamp: item.timestamp,
          params: item.params,
        }));
        const roundById = new Map(round.map(item => [item.id, item]));
        useAppStore.setState(current => ({
          chatHistory: current.chatHistory.map(item => roundById.get(item.id) ?? item),
        }));
        const assistant = round.find(item => item.id === assistantMessageId);
        return (assistant?.images ?? []).filter((image): image is string => typeof image === 'string');
      } catch (error) {
        console.error('刷新任务轮次失败:', error);
        return [];
      }
    };

    const unsubscribe = wsManager.subscribe((message) => {
      if (message.type === 'initial_state' && message.data) {
        const serverIsGenerating = message.data.is_generating === true;
        const lastTask = (message.data.last_task as LastTaskInfo | null) ?? null;

        if (serverIsGenerating && lastTask && lastTask.status === 'running' && lastTask.message_id) {
          const state = useAppStore.getState();
          if (
            state.currentGeneratingMessageId !== lastTask.message_id
            || state.currentGenerationTaskId !== (lastTask.task_id ?? null)
          ) {
            useAppStore.setState({
              currentGeneratingMessageId: lastTask.message_id,
              currentGenerationTaskId: lastTask.task_id ?? null,
              isGenerating: true,
            });
            messageApi.info('检测到正在进行的生成任务，已恢复显示');
          }
          return;
        }

        if (
          lastTask &&
          lastTask.message_id &&
          lastTask.session_id &&
          (lastTask.status === 'completed' || lastTask.status === 'error')
        ) {
          const currentSessionId = useAppStore.getState().currentSessionId;
          useAppStore.setState({
            isGenerating: false,
            currentGeneratingMessageId: null,
            currentGenerationTaskId: null,
          });
          if (lastTask.session_id === currentSessionId) {
            void refreshMessageRound(lastTask.session_id, lastTask.message_id).then(images => {
              if (lastTask.status === 'completed' && images.length > 0) {
                const isVideo = images.some(url => /\.(mp4|webm)$/i.test(url) || url.includes('/video/'));
                messageApi.success(`生成已完成（连接恢复），共 ${images.length} 个${isVideo ? '视频' : '图片'}`);
              } else if (lastTask.status === 'error') {
                messageApi.error('上次生成失败: ' + (lastTask.error || '未知错误'));
              }
            });
          } else if (lastTask.status === 'error') {
            messageApi.error('上次生成失败: ' + (lastTask.error || '未知错误'));
          }
          return;
        }

        if (!serverIsGenerating) {
          const { currentGeneratingMessageId, isGenerating, chatHistory } = useAppStore.getState();
          if (isGenerating || currentGeneratingMessageId) {
            if (currentGeneratingMessageId) {
              const msg = chatHistory.find(m => m.id === currentGeneratingMessageId);
              const existingImages = (msg?.images?.filter(img => typeof img === 'string') ?? []) as string[];
              useAppStore.getState().updateChatImages(currentGeneratingMessageId, existingImages, false);
            }
            useAppStore.setState({
              isGenerating: false,
              currentGeneratingMessageId: null,
              currentGenerationTaskId: null,
            });
            messageApi.warning('连接已恢复，生成任务状态已重置');
          }
        }
        return;
      }

      if (message.type === WS_MESSAGE_TYPES.STATE_CHANGE) {
        const taskState = useAppStore.getState();
        if (message.task_id && message.task_id !== taskState.currentGenerationTaskId) return;
        if (!message.task_id && message.message_id && message.message_id !== taskState.currentGeneratingMessageId) return;

        if (message.field === STATE_FIELDS.IS_GENERATING) {
          const {
            currentGeneratingMessageId,
            isGenerating: wasGenerating,
          } = useAppStore.getState();
          if (currentGeneratingMessageId) {
            useAppStore.setState({ isGenerating: message.value });
            if (wasGenerating && !message.value) {
              const sessionId = message.session_id;
              useAppStore.setState({
                currentGeneratingMessageId: null,
                currentGenerationTaskId: null,
              });
              if (sessionId) {
                void refreshMessageRound(sessionId, currentGeneratingMessageId).then(images => {
                  if (images.length > 0) {
                    const isVideo = images.some(url => /\.(mp4|webm)$/i.test(url) || url.includes('/video/'));
                    messageApi.success(`生成完成！共 ${images.length} 个${isVideo ? '视频' : '图片'}`);
                  }
                });
              }
            }
          }
        }

        if (message.field === STATE_FIELDS.ERROR && message.value) {
          const { currentGeneratingMessageId } = useAppStore.getState();
          if (currentGeneratingMessageId) {
            const sessionId = message.session_id;
            useAppStore.setState({
              currentGeneratingMessageId: null,
              currentGenerationTaskId: null,
              isGenerating: false,
            });
            if (sessionId) void refreshMessageRound(sessionId, currentGeneratingMessageId);
          }
          messageApi.error('生成失败: ' + message.value);
        }

        if (message.field === STATE_FIELDS.MEDIA_GENERATED && message.value) {
          const { image, index } = message.value;
          const { currentGeneratingMessageId } = useAppStore.getState();
          if (currentGeneratingMessageId) {
            useAppStore.getState().appendChatMedia(currentGeneratingMessageId, image, index);
          }
        }
      }
    });

    void loadData().then(() => {
      if (!disposed && isLoggedIn()) wsManager.connect();
    });

    apiService.getServiceStatus()
      .then(status => setServiceStatus(status))
      .catch(err => setError(err.message));

    return () => {
      disposed = true;
      unsubscribe();
      wsManager.disconnect();
    };
  }, [setServiceStatus, setError, loadUserConfig, loadSessions, messageApi]);

  const controlSelectedColor = isDark ? '#6ea8fe' : '#2563eb';
  const controlSelectedHoverColor = isDark ? '#8bb9ff' : '#1d4ed8';
  const controlSelectedTextColor = isDark ? '#0d0d0d' : '#ffffff';

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: isDark ? '#f4f4f4' : '#0d0d0d',
          colorPrimaryHover: isDark ? '#d9d9d9' : '#2f2f2f',
          colorPrimaryActive: isDark ? '#c7c7c7' : '#000000',
          colorTextLightSolid: isDark ? '#0d0d0d' : '#ffffff',
          colorInfo: isDark ? '#6ea8fe' : '#2563eb',
          colorSuccess: isDark ? '#6fcf97' : '#248a5a',
          colorWarning: isDark ? '#f0b36b' : '#a85c24',
          colorError: isDark ? '#ff7185' : '#c23b4d',
          colorText: isDark ? '#f4f4f4' : '#0d0d0d',
          colorTextSecondary: isDark ? '#b4b4b4' : '#5d5d5d',
          colorBgBase: isDark ? '#000000' : '#ffffff',
          colorBgContainer: isDark ? '#212121' : '#f7f7f8',
          colorBgElevated: isDark ? '#212121' : '#ffffff',
          colorFillSecondary: isDark ? '#2f2f2f' : '#ececec',
          colorBorder: isDark ? '#303030' : '#e5e5e5',
          borderRadius: 12,
        },
        components: {
          Switch: {
            colorPrimary: controlSelectedColor,
            colorPrimaryHover: controlSelectedHoverColor,
          },
          Checkbox: {
            colorPrimary: controlSelectedColor,
            colorPrimaryHover: controlSelectedHoverColor,
            colorWhite: controlSelectedTextColor,
          },
          Segmented: {
            itemSelectedBg: controlSelectedColor,
            itemSelectedColor: controlSelectedTextColor,
          },
        },
      }}
    >
      <AntApp>
        {contextHolder}
        <LoginModal
          open={forceLoginOpen}
          onClose={() => {}}
          onSuccess={() => { window.location.reload(); }}
          closable={false}
        />
        <Layout
          className={`app-layout ${isDark ? 'dark-mode' : 'light-mode'}`}
          inert={forceLoginOpen}
          aria-hidden={forceLoginOpen}
        >
          <StatusBar />

          <div className="app-content">
            {/* 左侧会话栏 */}
            <ChatSessionSidebar />
            
            {/* 主内容区域 */}
            <div className={`chat-container ${chatHistory.length === 0 ? 'empty-state' : ''}`}>
              {/* 结果展示区域 */}
              <div className={`results-area ${chatHistory.length === 0 ? 'empty' : ''}`}>
                {chatHistory.length > 0 && (
                  <Suspense fallback={<div className="result-grid-loading" role="status">正在加载创作记录...</div>}>
                    <ResultGrid />
                  </Suspense>
                )}
              </div>
              
              {/* 聊天输入区域 */}
              <div className="chat-input-area">
                {chatHistory.length === 0 && (
                  <div className="chat-welcome">
                    <h1 className="welcome-title">今天想创作什么？</h1>
                    <p className="welcome-subtitle">描述画面、添加参考图，或选择视频工作流开始创作</p>
                  </div>
                )}
                <ChatInput />
              </div>
            </div>
          </div>
        </Layout>
      </AntApp>
    </ConfigProvider>
  );
}

function App() {
  return <AppContent />;
}

export default App;
