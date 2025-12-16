import { useEffect, useState } from 'react';
import { Layout, ConfigProvider, theme, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import ChatInput from './components/ChatInput';
import ResultGrid from './components/ResultGrid';
import StatusBar from './components/StatusBar';
import { wsManager } from './api/websocket';
import { apiService } from './api/services';
import { useAppStore } from './stores/appStore';
import { isLoggedIn } from './utils/helpers';
import { WS_MESSAGE_TYPES, STATE_FIELDS } from './utils/constants';
import './App.css';

function AppContent() {
  const { setServiceStatus, setError, chatHistory, loadUserConfig } = useAppStore();
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // 检测系统主题
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDark(mediaQuery.matches);

    const handleThemeChange = (e: MediaQueryListEvent) => {
      setIsDark(e.matches);
    };

    mediaQuery.addEventListener('change', handleThemeChange);

    // 如果已登录，加载用户配置和聊天历史
    if (isLoggedIn()) {
      const loadData = async () => {
        await loadUserConfig();
        await useAppStore.getState().loadChatHistory();
      };
      loadData();
    }

    // 连接 WebSocket
    wsManager.connect();

    // 订阅 WebSocket 消息
    const unsubscribe = wsManager.subscribe((message) => {
      if (message.type === WS_MESSAGE_TYPES.STATE_CHANGE) {
        // 监听生成状态变化
        if (message.field === STATE_FIELDS.IS_GENERATING) {
          const wasGenerating = useAppStore.getState().isGenerating;
          useAppStore.setState({ isGenerating: message.value });
          
          // 生成完成时（从 true 变为 false），保存助手消息到数据库
          if (wasGenerating && !message.value) {
            const currentHistory = useAppStore.getState().chatHistory;
            const lastAssistantMsg = [...currentHistory].reverse().find(msg => msg.type === 'assistant');
            if (lastAssistantMsg && lastAssistantMsg.images) {
              useAppStore.getState().updateChatImages(
                lastAssistantMsg.id, 
                lastAssistantMsg.images.filter(img => typeof img === 'string') as string[]
              );
            }
          }
        }
        
        // 监听单张图片生成完成
        if (message.field === STATE_FIELDS.IMAGE_GENERATED && message.value) {
          const { image, index } = message.value;
          // 获取当前最新的 AI 消息 ID（最后一条 assistant 类型的消息）
          const currentHistory = useAppStore.getState().chatHistory;
          const lastAssistantMsg = [...currentHistory].reverse().find(msg => msg.type === 'assistant');
          if (lastAssistantMsg) {
            useAppStore.getState().appendChatImage(lastAssistantMsg.id, image, index);
          }
        }
      }
    });

    // 获取初始服务状态
    apiService.getServiceStatus()
      .then(status => setServiceStatus(status))
      .catch(err => setError(err.message));

    return () => {
      mediaQuery.removeEventListener('change', handleThemeChange);
      unsubscribe();
      wsManager.disconnect();
    };
  }, [setServiceStatus, setError]);

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
        </Layout>
      </AntApp>
    </ConfigProvider>
  );
}

function App() {
  return <AppContent />;
}

export default App;
