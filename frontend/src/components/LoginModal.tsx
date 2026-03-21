/**
 * 登录/注册弹窗
 */
import { useState } from 'react';
import { Modal, Form, Input, Tabs, message } from 'antd';
import { UserOutlined, LockOutlined, KeyOutlined } from '@ant-design/icons';
import { apiService } from '../api/services';
import { setAccessToken, setUsername } from '../utils/helpers';
import { VALIDATION } from '../utils/constants';

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (username: string) => void;
  closable?: boolean;
}

export default function LoginModal({ open, onClose, onSuccess, closable }: LoginModalProps) {
  const [loading, setLoading] = useState(false);
  const [loginForm] = Form.useForm();
  const [registerForm] = Form.useForm();

  const handleLogin = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const response = await apiService.login(values);
      setAccessToken(response.access_token);
      setUsername(values.username);
      message.success('登录成功！');
      loginForm.resetFields();
      onSuccess(values.username);
      onClose();
    } catch (error: any) {
      message.error(error.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (values: { username: string; password: string; invite_code: string }) => {
    setLoading(true);
    try {
      const response = await apiService.register(values);
      setAccessToken(response.access_token);
      setUsername(values.username);
      message.success('注册成功！');
      registerForm.resetFields();
      onSuccess(values.username);
      onClose();
    } catch (error: any) {
      message.error(error.message || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  const loginTab = (
    <Form
      form={loginForm}
      name="login"
      onFinish={handleLogin}
      autoComplete="off"
      layout="vertical"
    >
      <Form.Item
        name="username"
        label="用户名"
        rules={[
          { required: true, message: '请输入用户名' },
          { min: VALIDATION.USERNAME.MIN_LENGTH, message: `用户名至少${VALIDATION.USERNAME.MIN_LENGTH}个字符` },
          { max: VALIDATION.USERNAME.MAX_LENGTH, message: `用户名最多${VALIDATION.USERNAME.MAX_LENGTH}个字符` },
          { pattern: VALIDATION.USERNAME.PATTERN, message: '用户名只能包含字母、数字和下划线' }
        ]}
      >
        <Input
          prefix={<UserOutlined />}
          placeholder="用户名"
          size="large"
        />
      </Form.Item>

      <Form.Item
        name="password"
        label="密码"
        rules={[
          { required: true, message: '请输入密码' },
          { min: VALIDATION.PASSWORD.MIN_LENGTH, message: `密码至少${VALIDATION.PASSWORD.MIN_LENGTH}个字符` },
          { max: VALIDATION.PASSWORD.MAX_LENGTH, message: `密码最多${VALIDATION.PASSWORD.MAX_LENGTH}个字符` }
        ]}
      >
        <Input.Password
          prefix={<LockOutlined />}
          placeholder="密码"
          size="large"
        />
      </Form.Item>
    </Form>
  );

  const registerTab = (
    <Form
      form={registerForm}
      name="register"
      onFinish={handleRegister}
      autoComplete="off"
      layout="vertical"
    >
      <Form.Item
        name="username"
        label="用户名"
        rules={[
          { required: true, message: '请输入用户名' },
          { min: VALIDATION.USERNAME.MIN_LENGTH, message: `用户名至少${VALIDATION.USERNAME.MIN_LENGTH}个字符` },
          { max: VALIDATION.USERNAME.MAX_LENGTH, message: `用户名最多${VALIDATION.USERNAME.MAX_LENGTH}个字符` },
          { pattern: VALIDATION.USERNAME.PATTERN, message: '用户名只能包含字母、数字和下划线' }
        ]}
      >
        <Input
          prefix={<UserOutlined />}
          placeholder="用户名"
          size="large"
        />
      </Form.Item>

      <Form.Item
        name="password"
        label="密码"
        rules={[
          { required: true, message: '请输入密码' },
          { min: VALIDATION.PASSWORD.MIN_LENGTH, message: `密码至少${VALIDATION.PASSWORD.MIN_LENGTH}个字符` },
          { max: VALIDATION.PASSWORD.MAX_LENGTH, message: `密码最多${VALIDATION.PASSWORD.MAX_LENGTH}个字符` }
        ]}
      >
        <Input.Password
          prefix={<LockOutlined />}
          placeholder="密码"
          size="large"
        />
      </Form.Item>

      <Form.Item
        name="confirmPassword"
        label="确认密码"
        dependencies={['password']}
        rules={[
          { required: true, message: '请确认密码' },
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
          prefix={<LockOutlined />}
          placeholder="确认密码"
          size="large"
        />
      </Form.Item>

      <Form.Item
        name="invite_code"
        label="邀请码"
        rules={[{ required: true, message: '请输入邀请码' }]}
      >
        <Input
          prefix={<KeyOutlined />}
          placeholder="邀请码"
          size="large"
        />
      </Form.Item>
    </Form>
  );

  const isClosable = closable !== false;

  return (
    <Modal
      title="账户登录"
      open={open}
      onCancel={isClosable ? onClose : undefined}
      closable={isClosable}
      maskClosable={isClosable}
      keyboard={isClosable}
      onOk={() => {
        const activeKey = document.querySelector('.ant-tabs-tab-active')?.getAttribute('data-node-key');
        if (activeKey === 'login') {
          loginForm.submit();
        } else {
          registerForm.submit();
        }
      }}
      okText="确定"
      cancelText={isClosable ? '取消' : undefined}
      footer={isClosable ? undefined : (_, { OkBtn }) => <OkBtn />}
      confirmLoading={loading}
      width={450}
      centered
    >
      <Tabs
        defaultActiveKey="login"
        centered
        items={[
          {
            key: 'login',
            label: '登录',
            children: loginTab,
          },
          {
            key: 'register',
            label: '注册',
            children: registerTab,
          },
        ]}
      />
    </Modal>
  );
}
