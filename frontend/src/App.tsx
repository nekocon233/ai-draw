import { lazy, Suspense, useEffect, useState } from 'react';
import { Layout, ConfigProvider, theme, App as AntApp, message } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import ChatInput from './components/ChatInput';
import StatusBar from './components/StatusBar';
import ChatSessionSidebar from './components/ChatSessionSidebar';
import LoginModal from './components/LoginModal';
import { wsManager } from './api/websocket';
import { useAppStore } from './stores/appStore';
import { AUTH_REQUIRED_EVENT, clearAccessToken, getAccessTokenExpiry, isLoggedIn } from './utils/helpers';
import { useGenerationConnection } from './features/generation/useGenerationConnection';
import './App.css';

const ResultGrid = lazy(() => import('./components/ResultGrid'));

function AppContent() {
  const chatHistory = useAppStore(state => state.chatHistory);
  const [isDark, setIsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [messageApi, contextHolder] = message.useMessage();
  const [forceLoginOpen, setForceLoginOpen] = useState(!isLoggedIn());

  useGenerationConnection(messageApi);

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
      useAppStore.getState().finishGeneration();
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
          // Image previews always use a dark overlay, regardless of the app theme.
          Image: {
            colorTextLightSolid: '#ffffff',
            previewOperationColor: 'rgba(255, 255, 255, 0.85)',
            previewOperationHoverColor: '#ffffff',
            previewOperationColorDisabled: 'rgba(255, 255, 255, 0.35)',
          },
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
