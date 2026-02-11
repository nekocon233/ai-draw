/**
 * Axios HTTP 客户端配置
 */
import axios, { AxiosError } from 'axios';
import { message as antdMessage } from 'antd';
import { getMessageApi } from '../utils/antd-helpers';
import { getAccessToken, clearAccessToken } from '../utils/helpers';

// 获取 message 实例的辅助函数
const getMessage = () => {
  const api = getMessageApi();
  if (api) {
    return api;
  }
  
  // Fallback to static methods if App context is not yet available
  // Note: Static methods might not work with context-based features (like themes)
  // but they prevent "is not a function" errors.
  if (antdMessage && typeof antdMessage.error === 'function') {
    return antdMessage;
  }

  // Last resort fallback to console to prevent crash
  console.warn('Message API not available, falling back to console');
  return {
    success: (content: any) => console.log('Success:', content),
    error: (content: any) => console.error('Error:', content),
    info: (content: any) => console.log('Info:', content),
    warning: (content: any) => console.warn('Warning:', content),
    loading: (content: any) => console.log('Loading:', content),
    open: (config: any) => console.log('Message:', config),
    destroy: () => {},
  } as any;
};

/**
 * API 错误响应格式
 */
interface APIErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
}

/**
 * API 成功响应格式
 */
interface APISuccessResponse<T = any> {
  success: true;
  data: T;
}

export type APIResponse<T = any> = APISuccessResponse<T> | APIErrorResponse;

const client = axios.create({
  baseURL: '/api',
  timeout: 300000, // 5 分钟
  headers: {
    'Content-Type': 'application/json',
  }
});

// 请求拦截器 - 添加 Token
client.interceptors.request.use(
  config => {
    const token = getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  error => {
    console.error('Request error:', error);
    return Promise.reject(error);
  }
);

// 响应拦截器 - 统一错误处理
client.interceptors.response.use(
  response => {
    // 成功响应直接返回 data
    return response.data;
  },
  (error: AxiosError<any>) => {
    console.error('Response error:', error);
    
    // 处理网络错误
    if (!error.response) {
      getMessage().error('网络连接失败，请检查网络设置');
      return Promise.reject(new Error('网络连接失败'));
    }

    const status = error.response.status;
    const data: any = error.response.data as any;
    const requestId = error.response.headers['x-request-id'];
    if (import.meta.env.DEV) {
      console.debug('[API] error response', { status, requestId, data });
    }

    const showError = (msg: string) => {
      const finalMsg = requestId ? `${msg} (ID: ${requestId})` : msg;
      getMessage().error(finalMsg);
    };
    
    // 统一错误消息格式
    let errorMessage = '请求失败';
    let errorCode = 'UNKNOWN_ERROR';
    
    if (data?.error) {
      // 后端返回的标准错误格式
      errorMessage = data.error.message;
      errorCode = data.error.code;
      
      // 特殊错误码处理
      switch (errorCode) {
        case 'AUTHENTICATION_ERROR':
          clearAccessToken();
          showError('认证失败，请重新登录');
          break;
          
        case 'AUTHORIZATION_ERROR':
          showError('权限不足');
          break;
          
        case 'RESOURCE_NOT_FOUND':
          showError('资源不存在');
          break;
          
        case 'VALIDATION_ERROR':
          // 验证错误显示详细信息
          if (data.error.details?.errors) {
            const validationErrors = data.error.details.errors as Array<{
              field: string;
              message: string;
            }>;
            const firstError = validationErrors[0];
            showError(`${firstError.field}: ${firstError.message}`);
          } else {
            showError(errorMessage);
          }
          break;
          
        case 'DATABASE_ERROR':
          showError('数据库操作失败，请稍后重试');
          break;
          
        case 'EXTERNAL_SERVICE_ERROR':
          showError('外部服务暂时不可用，请稍后重试');
          break;
          
        default:
          showError(errorMessage);
      }
    } else {
      // 兼容旧版错误格式
      if (typeof data === 'string' && data.trim()) {
        errorMessage = data.trim();
      } else {
        errorMessage = (data as any)?.detail || (error.response.statusText ? `HTTP ${status} ${error.response.statusText}` : '') || error.message || '请求失败';
      }
      
      // HTTP 状态码处理
      switch (status) {
        case 400:
          showError(`请求参数错误: ${errorMessage}`);
          break;
        case 401:
          clearAccessToken();
          showError('认证失败，请重新登录');
          break;
        case 403:
          showError('权限不足');
          break;
        case 404:
          showError('资源不存在');
          break;
        case 500:
          showError((data as any)?.detail || '服务器内部错误');
          break;
        case 503:
          showError('服务暂时不可用');
          break;
        default:
          showError(errorMessage);
      }
    }
    
    // 创建统一的错误对象
    const apiError = new Error(errorMessage);
    (apiError as any).code = errorCode;
    (apiError as any).status = status;
    (apiError as any).details = data?.error?.details;
    (apiError as any).requestId = requestId;
    (apiError as any).raw = data;
    
    return Promise.reject(apiError);
  }
);

export default client;
