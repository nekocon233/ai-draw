import { useEffect, useState } from 'react';
import { Layout, ConfigProvider, theme, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import ChatInput from './components/ChatInput';
import ResultGrid from './components/ResultGrid';
import StatusBar from './components/StatusBar';
import ChatSessionSidebar from './components/ChatSessionSidebar';
import { wsManager } from './api/websocket';
import { apiService } from './api/services';
import { useAppStore } from './stores/appStore';
import { isLoggedIn, getStorageUsage } from './utils/helpers';
import { WS_MESSAGE_TYPES, STATE_FIELDS, STORAGE_CONFIG } from './utils/constants';
import './App.css';

function AppContent() {
  const { setServiceStatus, setError, chatHistory, loadUserConfig, loadSessions } = useAppStore();
  const [isDark, setIsDark] = useState(false);
  const { message } = AntApp.useApp();

  // 主题检测和存储监控
  useEffect(() => {
    // 检测系统主题
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDark(mediaQuery.matches);

    const handleThemeChange = (e: MediaQueryListEvent) => {
      setIsDark(e.matches);
    };

    mediaQuery.addEventListener('change', handleThemeChange);

    // 检查游客模式的存储使用情况
    let storageCheckInterval: number | null = null;
    if (!isLoggedIn()) {
      const checkStorage = () => {
        const usage = getStorageUsage();
        if (usage.percentage > STORAGE_CONFIG.WARN_USAGE_PERCENTAGE) {
          // message.warning({
          //   content: `浏览器存储空间已使用 ${usage.percentage.toFixed(0)}%，建议登录以保存更多历史记录`,
          //   duration: 5,
          // });
        }
      };
      
      // 启动时检查
      checkStorage();
      
      // 每 30 秒检查一次
      storageCheckInterval = setInterval(checkStorage, 30000);
    }
    
    return () => {
      mediaQuery.removeEventListener('change', handleThemeChange);
      if (storageCheckInterval) {
        clearInterval(storageCheckInterval);
      }
    };
  }, [message]);

  // 数据加载和 WebSocket 连接
  useEffect(() => {
    // 加载用户配置和聊天历史（登录用户从后端加载，游客从 localStorage 加载）
    const loadData = async () => {
      try {
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
      } catch (error) {
        console.error('Initial data loading failed:', error);
      }
    };
    loadData();

    // 连接 WebSocket
    wsManager.connect();

    // 订阅 WebSocket 消息
    const unsubscribe = wsManager.subscribe((message) => {
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
              if (msg && msg.images) {
                useAppStore.getState().updateChatImages(
                  currentGeneratingMessageId, 
                  msg.images.filter(img => typeof img === 'string') as string[]
                );
              }
              // 清除当前生成任务ID
              useAppStore.setState({ currentGeneratingMessageId: null });
            }
          }
        }
        
        // 监听单张图片生成完成
        if (message.field === STATE_FIELDS.IMAGE_GENERATED && message.value) {
          const { image, index } = message.value;
          // 只处理当前设备正在生成的消息
          const { currentGeneratingMessageId } = useAppStore.getState();
          if (currentGeneratingMessageId) {
            useAppStore.getState().appendChatImage(currentGeneratingMessageId, image, index);
          }
        }
      }
    });

    // 获取初始服务状态
    apiService.getServiceStatus()
      .then(status => setServiceStatus(status.available))
      .catch(err => {
        setServiceStatus(false);
        // 不弹出错误，避免启动时报错干扰
        // setError(err.message);
      });

    return () => {
      unsubscribe();
      wsManager.disconnect();
    };
  }, [setServiceStatus, setError, loadUserConfig, loadSessions]);

  return (
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
  );
}

function App() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDark(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

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
        <AppContent />
      </AntApp>
    </ConfigProvider>
  );
}

export default App;
