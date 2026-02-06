/**
 * Axios HTTP 客户端配置
 */
import axios, { AxiosError } from 'axios';
import { message } from 'antd';
import { getAccessToken, clearAccessToken } from '../utils/helpers';

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
  (error: AxiosError<APIErrorResponse>) => {
    console.error('Response error:', error);
    
    // 处理网络错误
    if (!error.response) {
      message.error('网络连接失败，请检查网络设置');
      return Promise.reject(new Error('网络连接失败'));
    }

    const { status, data } = error.response;
    
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
          message.error('认证失败，请重新登录');
          break;
          
        case 'AUTHORIZATION_ERROR':
          message.error('权限不足');
          break;
          
        case 'RESOURCE_NOT_FOUND':
          message.error('资源不存在');
          break;
          
        case 'VALIDATION_ERROR':
          // 验证错误显示详细信息
          if (data.error.details?.errors) {
            const validationErrors = data.error.details.errors as Array<{
              field: string;
              message: string;
            }>;
            const firstError = validationErrors[0];
            message.error(`${firstError.field}: ${firstError.message}`);
          } else {
            message.error(errorMessage);
          }
          break;
          
        case 'DATABASE_ERROR':
          message.error('数据库操作失败，请稍后重试');
          break;
          
        case 'EXTERNAL_SERVICE_ERROR':
          message.error('外部服务暂时不可用，请稍后重试');
          break;
          
        default:
          message.error(errorMessage);
      }
    } else {
      // 兼容旧版错误格式
      errorMessage = (data as any)?.detail || error.message || '请求失败';
      
      // HTTP 状态码处理
      switch (status) {
        case 400:
          message.error(`请求参数错误: ${errorMessage}`);
          break;
        case 401:
          clearAccessToken();
          message.error('认证失败，请重新登录');
          break;
        case 403:
          message.error('权限不足');
          break;
        case 404:
          message.error('资源不存在');
          break;
        case 500:
          message.error('服务器内部错误');
          break;
        case 503:
          message.error('服务暂时不可用');
          break;
        default:
          message.error(errorMessage);
      }
    }
    
    // 创建统一的错误对象
    const apiError = new Error(errorMessage);
    (apiError as any).code = errorCode;
    (apiError as any).status = status;
    (apiError as any).details = data?.error?.details;
    
    return Promise.reject(apiError);
  }
);

export default client;
