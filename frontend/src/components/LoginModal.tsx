/**
 * 登录/注册弹窗
 */
import { useState } from 'react';
import { Button, Form, Input, Modal, Tabs, message } from 'antd';
import { KeyOutlined, LockOutlined, UserOutlined } from '@ant-design/icons';
import { apiService } from '../api/services';
import { setAccessToken, setUsername } from '../utils/helpers';
import { VALIDATION } from '../utils/constants';
import './LoginModal.css';

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (username: string) => void;
  closable?: boolean;
}

type AuthMode = 'login' | 'register';

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export default function LoginModal({ open, onClose, onSuccess, closable }: LoginModalProps) {
  const [loading, setLoading] = useState(false);
  const [activeMode, setActiveMode] = useState<AuthMode>('login');
  const [loginForm] = Form.useForm();
  const [registerForm] = Form.useForm();

  const completeAuthentication = (accessToken: string, username: string) => {
    setAccessToken(accessToken);
    setUsername(username);
    onSuccess(username);
    onClose();
  };

  const handleLogin = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const response = await apiService.login(values);
      loginForm.resetFields();
      completeAuthentication(response.access_token, values.username);
      message.success('欢迎回来');
    } catch (error: unknown) {
      message.error(getErrorMessage(error, '登录失败，请检查用户名和密码'));
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (values: { username: string; password: string; invite_code: string }) => {
    setLoading(true);
    try {
      const response = await apiService.register(values);
      registerForm.resetFields();
      completeAuthentication(response.access_token, values.username);
      message.success('账户创建成功');
    } catch (error: unknown) {
      message.error(getErrorMessage(error, '注册失败，请稍后重试'));
    } finally {
      setLoading(false);
    }
  };

  const loginTab = (
    <Form
      form={loginForm}
      name="login"
      onFinish={handleLogin}
      layout="vertical"
      requiredMark={false}
      className="login-modal-form"
    >
      <Form.Item
        name="username"
        label="用户名"
        rules={[
          { required: true, message: '请输入用户名' },
          { min: VALIDATION.USERNAME.MIN_LENGTH, message: `用户名至少${VALIDATION.USERNAME.MIN_LENGTH}个字符` },
          { max: VALIDATION.USERNAME.MAX_LENGTH, message: `用户名最多${VALIDATION.USERNAME.MAX_LENGTH}个字符` },
          { pattern: VALIDATION.USERNAME.PATTERN, message: '用户名只能包含字母、数字和下划线' },
        ]}
      >
        <Input
          prefix={<UserOutlined aria-hidden="true" />}
          placeholder="输入用户名"
          autoComplete="username"
          size="large"
        />
      </Form.Item>

      <Form.Item
        name="password"
        label="密码"
        rules={[
          { required: true, message: '请输入密码' },
          { min: VALIDATION.PASSWORD.MIN_LENGTH, message: `密码至少${VALIDATION.PASSWORD.MIN_LENGTH}个字符` },
          { max: VALIDATION.PASSWORD.MAX_LENGTH, message: `密码最多${VALIDATION.PASSWORD.MAX_LENGTH}个字符` },
        ]}
      >
        <Input.Password
          prefix={<LockOutlined aria-hidden="true" />}
          placeholder="输入密码"
          autoComplete="current-password"
          size="large"
        />
      </Form.Item>

      <Form.Item className="login-modal-submit">
        <Button type="primary" htmlType="submit" loading={loading} size="large" block>
          登录工作台
        </Button>
      </Form.Item>
    </Form>
  );

  const registerTab = (
    <Form
      form={registerForm}
      name="register"
      onFinish={handleRegister}
      layout="vertical"
      requiredMark={false}
      className="login-modal-form"
    >
      <Form.Item
        name="username"
        label="用户名"
        extra="可使用字母、数字和下划线"
        rules={[
          { required: true, message: '请输入用户名' },
          { min: VALIDATION.USERNAME.MIN_LENGTH, message: `用户名至少${VALIDATION.USERNAME.MIN_LENGTH}个字符` },
          { max: VALIDATION.USERNAME.MAX_LENGTH, message: `用户名最多${VALIDATION.USERNAME.MAX_LENGTH}个字符` },
          { pattern: VALIDATION.USERNAME.PATTERN, message: '用户名只能包含字母、数字和下划线' },
        ]}
      >
        <Input
          prefix={<UserOutlined aria-hidden="true" />}
          placeholder="设置用户名"
          autoComplete="username"
          size="large"
        />
      </Form.Item>

      <Form.Item
        name="password"
        label="密码"
        rules={[
          { required: true, message: '请输入密码' },
          { min: VALIDATION.PASSWORD.MIN_LENGTH, message: `密码至少${VALIDATION.PASSWORD.MIN_LENGTH}个字符` },
          { max: VALIDATION.PASSWORD.MAX_LENGTH, message: `密码最多${VALIDATION.PASSWORD.MAX_LENGTH}个字符` },
        ]}
      >
        <Input.Password
          prefix={<LockOutlined aria-hidden="true" />}
          placeholder={`至少 ${VALIDATION.PASSWORD.MIN_LENGTH} 个字符`}
          autoComplete="new-password"
          size="large"
        />
      </Form.Item>

      <Form.Item
        name="confirmPassword"
        label="确认密码"
        dependencies={['password']}
        rules={[
          { required: true, message: '请再次输入密码' },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('password') === value) {
                return Promise.resolve();
              }
              return Promise.reject(new Error('两次输入的密码不一致'));
            },
          }),
        ]}
      >
        <Input.Password
          prefix={<LockOutlined aria-hidden="true" />}
          placeholder="再次输入密码"
          autoComplete="new-password"
          size="large"
        />
      </Form.Item>

      <Form.Item
        name="invite_code"
        label="邀请码"
        rules={[{ required: true, message: '请输入邀请码' }]}
      >
        <Input
          prefix={<KeyOutlined aria-hidden="true" />}
          placeholder="输入邀请码"
          autoComplete="off"
          size="large"
        />
      </Form.Item>

      <Form.Item className="login-modal-submit">
        <Button type="primary" htmlType="submit" loading={loading} size="large" block>
          创建账户并进入
        </Button>
      </Form.Item>
    </Form>
  );

  const isClosable = closable !== false;
  const isLogin = activeMode === 'login';

  return (
    <Modal
      title={isLogin ? '登录 AI 创作工作台' : '注册 AI 创作工作台'}
      open={open}
      onCancel={isClosable ? onClose : undefined}
      closable={isClosable}
      maskClosable={isClosable}
      keyboard={isClosable}
      footer={null}
      width={820}
      centered
      rootClassName="login-modal-root"
      className="login-modal"
    >
      <div className="login-modal-shell">
        <aside className="login-modal-intro" aria-label="AI 创作工作台介绍">
          <div>
            <div className="login-brand">
              <span className="login-brand-mark" aria-hidden="true">
                <span />
              </span>
              <span>AI Draw</span>
            </div>
            <h2>把灵感留在同一个工作流里</h2>
            <p>从图像与视频生成，到素材处理和导出，专注完成每一次创作。</p>
          </div>
          <ul className="login-capabilities" aria-label="工作台能力">
            <li><span aria-hidden="true" />图像生成与编辑</li>
            <li><span aria-hidden="true" />视频创作与抽帧</li>
            <li><span aria-hidden="true" />会话与配置同步</li>
          </ul>
        </aside>

        <section className="login-modal-auth">
          <header className="login-modal-header">
            <p className="login-modal-product">AI 创作工作台</p>
            <h1>{isLogin ? '欢迎回来' : '创建你的账户'}</h1>
            <p>{isLogin ? '登录后继续你的创作会话。' : '使用邀请码注册，开始新的创作。'}</p>
          </header>

          <Tabs
            activeKey={activeMode}
            onChange={(key) => setActiveMode(key as AuthMode)}
            className="login-modal-tabs"
            items={[
              { key: 'login', label: '登录', children: loginTab },
              { key: 'register', label: '注册', children: registerTab },
            ]}
          />

          <p className="login-modal-note">账户用于安全同步创作会话、配置与生成记录。</p>
        </section>
      </div>
    </Modal>
  );
}
