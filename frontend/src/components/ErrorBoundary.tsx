import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Result } from 'antd';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * React 错误边界组件
 * 捕获子组件树中的 JavaScript 错误，记录错误并显示降级 UI
 */
class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // 更新 state 使下一次渲染能够显示降级后的 UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // 记录错误信息
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    
    this.setState({
      error,
      errorInfo,
    });

    // 可以将错误信息发送到错误追踪服务（如 Sentry）
    // logErrorToService(error, errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    const { hasError, error, errorInfo } = this.state;
    const { children, fallback } = this.props;

    if (hasError) {
      // 如果提供了自定义降级 UI，则使用它
      if (fallback) {
        return fallback;
      }

      // 默认错误 UI
      return (
        <div style={{ 
          minHeight: '100vh', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          padding: '20px'
        }}>
          <Result
            status="error"
            title="应用程序发生错误"
            subTitle={error?.message || '抱歉，出现了一些问题'}
            extra={[
              <Button type="primary" key="reset" onClick={this.handleReset}>
                重试
              </Button>,
              <Button key="reload" onClick={this.handleReload}>
                刷新页面
              </Button>,
            ]}
          >
            {import.meta.env.DEV && errorInfo && (
              <div style={{ 
                textAlign: 'left', 
                maxWidth: '800px', 
                margin: '20px auto',
                padding: '16px',
                background: '#f5f5f5',
                borderRadius: '8px',
                overflow: 'auto'
              }}>
                <h3>错误详情（仅开发环境显示）：</h3>
                <pre style={{ fontSize: '12px', whiteSpace: 'pre-wrap' }}>
                  {error?.stack}
                </pre>
                <h3>组件堆栈：</h3>
                <pre style={{ fontSize: '12px', whiteSpace: 'pre-wrap' }}>
                  {errorInfo.componentStack}
                </pre>
              </div>
            )}
          </Result>
        </div>
      );
    }

    return children;
  }
}

export default ErrorBoundary;
