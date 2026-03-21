import { useEffect, useState } from 'react';
import { Layout, ConfigProvider, theme, App as AntApp, message } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import ChatInput from './components/ChatInput';
import ResultGrid from './components/ResultGrid';
import StatusBar from './components/StatusBar';
import ChatSessionSidebar from './components/ChatSessionSidebar';
import LoginModal from './components/LoginModal';
import { wsManager } from './api/websocket';
import { apiService } from './api/services';
import { useAppStore } from './stores/appStore';
import { isLoggedIn } from './utils/helpers';
import { WS_MESSAGE_TYPES, STATE_FIELDS } from './utils/constants';
import './App.css';

function AppContent() {
  const { setServiceStatus, setError, chatHistory, loadUserConfig, loadSessions } = useAppStore();
  const [isDark, setIsDark] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const [forceLoginOpen] = useState(!isLoggedIn());

  // 主题检测
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDark(mediaQuery.matches);

    const handleThemeChange = (e: MediaQueryListEvent) => {
      setIsDark(e.matches);
    };

    mediaQuery.addEventListener('change', handleThemeChange);
    return () => {
      mediaQuery.removeEventListener('change', handleThemeChange);
    };
  }, []);

  // 数据加载和 WebSocket 连接
  useEffect(() => {
    // 加载用户配置和聊天历史（登录用户从后端加载，游客从 localStorage 加载）
    const loadData = async () => {
      // 1. 先加载默认配置（从后端获取）
      await useAppStore.getState().loadDefaultConfig();
      
      // 2. 加载可用工作流列表
      await useAppStore.getState().loadAvailableWorkflows();
      
      // 3. 如果已登录，加载用户配置（会覆盖默认配置）
      if (isLoggedIn()) {
        await loadUserConfig();
      }
      
      // 4. 加载会话列表（switchSession 会自动加载对应会话的历史）
      await loadSessions();
    };
    loadData();

    // 连接 WebSocket
    wsManager.connect();

    // 订阅 WebSocket 消息
    const unsubscribe = wsManager.subscribe((message) => {
      // 处理初始状态（连接/重连时服务端推送）
      if (message.type === 'initial_state' && message.data) {
        // 若服务端未在生成，但前端仍认为在生成（服务重启/断线场景），立即重置
        if (!message.data.is_generating) {
          const { currentGeneratingMessageId, isGenerating, chatHistory } = useAppStore.getState();
          if (isGenerating || currentGeneratingMessageId) {
            // 保留断线前已通过 media_generated 收到的媒体（如视频），而非无条件清空
            if (currentGeneratingMessageId) {
              const msg = chatHistory.find(m => m.id === currentGeneratingMessageId);
              const existingImages = (msg?.images?.filter(img => typeof img === 'string') ?? []) as string[];
              useAppStore.getState().updateChatImages(currentGeneratingMessageId, existingImages);
            }
            useAppStore.setState({ isGenerating: false, currentGeneratingMessageId: null });
            messageApi.warning('连接已恢复，生成任务状态已重置');
          }
        }
        return;
      }

      if (message.type === WS_MESSAGE_TYPES.STATE_CHANGE) {
        // 监听生成状态变化（仅当前设备有生成任务时才更新）
        if (message.field === STATE_FIELDS.IS_GENERATING) {
          const { currentGeneratingMessageId, isGenerating: wasGenerating } = useAppStore.getState();
          
          // 只有当前设备正在生成时才更新状态
          if (currentGeneratingMessageId) {
            useAppStore.setState({ isGenerating: message.value });
            
            // 生成完成时（从 true 变为 false），保存助手消息到数据库
            if (wasGenerating && !message.value) {
              const currentHistory = useAppStore.getState().chatHistory;
              const msg = currentHistory.find(m => m.id === currentGeneratingMessageId);
              const images = (msg?.images?.filter(img => typeof img === 'string') ?? []) as string[];
              // 无论是否有图片，都必须调用 updateChatImages 清除 loading 占位符
              useAppStore.getState().updateChatImages(currentGeneratingMessageId, images);
              if (images.length > 0) {
                const isVideo = images.some(u => /\.(mp4|webm)$/i.test(u) || u.includes('/video/'));
                messageApi.success(`生成完成！共 ${images.length} 个${isVideo ? '视频' : '图片'}`);
              }
              // 清除当前生成任务ID
              useAppStore.setState({ currentGeneratingMessageId: null });
            }
          }
        }

        // 监听生成错误（WebSocket 推送错误信息）
        if (message.field === STATE_FIELDS.ERROR && message.value) {
          const { currentGeneratingMessageId } = useAppStore.getState();
          if (currentGeneratingMessageId) {
            useAppStore.getState().updateChatImages(currentGeneratingMessageId, []);
            useAppStore.setState({ currentGeneratingMessageId: null, isGenerating: false });
          }
          messageApi.error('生成失败: ' + message.value);
        }
        
        // 监听单张图片生成完成
        if (message.field === STATE_FIELDS.MEDIA_GENERATED && message.value) {
          const { image, index } = message.value;
          // 只处理当前设备正在生成的消息
          const { currentGeneratingMessageId } = useAppStore.getState();
          if (currentGeneratingMessageId) {
            useAppStore.getState().appendChatMedia(currentGeneratingMessageId, image, index);
          }
        }
      }
    });

    // 获取初始服务状态
    apiService.getServiceStatus()
      .then(status => setServiceStatus(status))
      .catch(err => setError(err.message));

    return () => {
      unsubscribe();
      wsManager.disconnect();
    };
  }, [setServiceStatus, setError, loadUserConfig, loadSessions]);

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#8250df',
          borderRadius: 12,
          colorBgContainer: isDark ? '#161b22' : '#ffffff',
        },
      }}
    >
      <AntApp>
        {contextHolder}
        <LoginModal
          open={forceLoginOpen}
          onClose={() => {}}
          onSuccess={(_username) => { window.location.reload(); }}
          closable={false}
        />
        <Layout className={`app-layout ${isDark ? 'dark-mode' : 'light-mode'}`}>
          {/* 顶部状态栏 */}
          <div style={{ 
            padding: '12px 24px', 
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            background: isDark ? 'rgba(22, 27, 34, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(10px)'
          }}>
            <StatusBar />
          </div>

          <div className="app-content">
            {/* 左侧会话栏 */}
            <ChatSessionSidebar />
            
            {/* 主内容区域 */}
            <div className={`chat-container ${chatHistory.length === 0 ? 'empty-state' : ''}`}>
              {/* 结果展示区域 */}
              <div className={`results-area ${chatHistory.length === 0 ? 'empty' : ''}`}>
                <ResultGrid />
              </div>
              
              {/* 聊天输入区域 */}
              <div className="chat-input-area">
                {chatHistory.length === 0 && (
                  <div className="chat-welcome">
                    <h2 className="welcome-title">AI-DRAW</h2>
                    <p className="welcome-subtitle">用文字描述，创造无限可能</p>
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
