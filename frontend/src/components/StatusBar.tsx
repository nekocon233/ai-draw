import { useState } from 'react';
import { Space, Tag, Button, Dropdown } from 'antd';
import { LoadingOutlined, UserOutlined, LogoutOutlined, LoginOutlined } from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import LoginModal from './LoginModal';
import { isLoggedIn as checkLoggedIn, getUsername, clearAccessToken } from '../utils/helpers';

export default function StatusBar() {
  const { isGenerating, isGeneratingPrompt, error } = useAppStore();
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
    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
      <Space>
        {isGenerating && (
          <Tag icon={<LoadingOutlined />} color="processing">
            生成图片中...
          </Tag>
        )}

        {isGeneratingPrompt && (
          <Tag icon={<LoadingOutlined />} color="processing">
            生成提示词中...
          </Tag>
        )}

        {error && (
          <Tag color="error">
            错误: {error}
          </Tag>
        )}
      </Space>

      <Space style={{ marginLeft: 'auto' }}>
        {isLoggedIn ? (
          <Dropdown menu={{ items: userMenuItems }} placement="topRight">
            <Button type="text" icon={<UserOutlined />}>
              {username}
            </Button>
          </Dropdown>
        ) : (
          <Button
            type="primary"
            icon={<LoginOutlined />}
            onClick={() => setLoginModalOpen(true)}
          >
            登录
          </Button>
        )}
      </Space>
      
      <LoginModal
        open={loginModalOpen}
        onClose={() => setLoginModalOpen(false)}
        onSuccess={handleLoginSuccess}
      />
    </Space>
  );
}
