import { useState } from 'react';
import { Tag, Button, Dropdown } from 'antd';
import { LoadingOutlined, UserOutlined, LogoutOutlined, LoginOutlined } from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import { useShallow } from 'zustand/react/shallow';
import LoginModal from './LoginModal';
import { isLoggedIn as checkLoggedIn, getUsername, clearAccessToken } from '../utils/helpers';

export function AccountMenu({ collapsed = false }: { collapsed?: boolean }) {
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [username, setUsername] = useState(getUsername() || '');
  const isLoggedIn = checkLoggedIn();

  const handleLogout = () => {
    clearAccessToken();
    setUsername('');
    window.location.reload(); // 刷新页面清空状态
  };

  const handleLoginSuccess = (newUsername: string) => {
    setUsername(newUsername);
    // 刷新页面以加载用户数据
    window.location.reload();
  };

  const userMenuItems = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ];

  return (
    <>
      {isLoggedIn ? (
        <Dropdown menu={{ items: userMenuItems }} placement="topLeft" trigger={['click']}>
          <Button
            className="account-menu-button"
            type="text"
            icon={<UserOutlined />}
            aria-label={collapsed ? `账户：${username}` : undefined}
          >
            {!collapsed && <span>{username}</span>}
          </Button>
        </Dropdown>
      ) : (
        <Button
          className="account-menu-button"
          type="text"
          icon={<LoginOutlined />}
          onClick={() => setLoginModalOpen(true)}
          aria-label={collapsed ? '登录' : undefined}
        >
          {!collapsed && <span>登录</span>}
        </Button>
      )}

      <LoginModal
        open={loginModalOpen}
        onClose={() => setLoginModalOpen(false)}
        onSuccess={handleLoginSuccess}
      />
    </>
  );
}

export default function StatusBar() {
  const { isGenerating, isGeneratingPrompt, error, clearError, isServiceAvailable, serviceStatusChecked } = useAppStore(useShallow(state => ({
    isGenerating: state.isGenerating,
    isGeneratingPrompt: state.isGeneratingPrompt,
    error: state.error,
    clearError: state.clearError,
    isServiceAvailable: state.isServiceAvailable,
    serviceStatusChecked: state.serviceStatusChecked,
  })));

  const serviceUnavailable = serviceStatusChecked && !isServiceAvailable;
  if (!isGenerating && !isGeneratingPrompt && !error && !serviceUnavailable) return null;

  return (
    <div className="app-status-bar" role="status" aria-live="polite">
      {isGenerating && (
        <Tag icon={<LoadingOutlined />} color="processing">
          正在生成
        </Tag>
      )}
      {isGeneratingPrompt && (
        <Tag icon={<LoadingOutlined />} color="processing">
          正在生成提示词
        </Tag>
      )}
      {error && (
        <Tag color="error" role="alert" closable onClose={clearError} aria-label={`${error}，关闭错误提示`}>
          {error}
        </Tag>
      )}
      {serviceUnavailable && !error && (
        <Tag color="error" role="alert">ComfyUI 服务暂不可用</Tag>
      )}
    </div>
  );
}
