/**
 * 前端工具函数
 */
import { STORAGE_KEYS } from './constants';

// ============ 本地存储 ============

/**
 * 检查用户是否已登录
 */
export function isLoggedIn(): boolean {
  return !!localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
}

/**
 * 获取访问令牌
 */
export function getAccessToken(): string | null {
  return localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
}

/**
 * 设置访问令牌
 */
export function setAccessToken(token: string): void {
  localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, token);
}

/**
 * 清除访问令牌
 */
export function clearAccessToken(): void {
  localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.USERNAME);
}

/**
 * 获取用户名
 */
export function getUsername(): string | null {
  return localStorage.getItem(STORAGE_KEYS.USERNAME);
}

/**
 * 设置用户名
 */
export function setUsername(username: string): void {
  localStorage.setItem(STORAGE_KEYS.USERNAME, username);
}

// ============ 游客配置 ============

/**
 * 加载游客配置
 */
export function loadGuestConfig(): any | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.GUEST_CONFIG);
    return saved ? JSON.parse(saved) : null;
  } catch (error) {
    console.error('加载游客配置失败:', error);
    return null;
  }
}

/**
 * 保存游客配置
 */
export function saveGuestConfig(config: any): void {
  try {
    localStorage.setItem(STORAGE_KEYS.GUEST_CONFIG, JSON.stringify(config));
  } catch (error) {
    console.error('保存游客配置失败:', error);
  }
}

/**
 * 加载游客聊天记录
 */
export function loadGuestChatHistory(): any[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.GUEST_CHAT_HISTORY);
    return saved ? JSON.parse(saved) : [];
  } catch (error) {
    console.error('加载游客聊天记录失败:', error);
    return [];
  }
}

/**
 * 保存游客聊天记录
 */
export function saveGuestChatHistory(messages: any[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.GUEST_CHAT_HISTORY, JSON.stringify(messages));
  } catch (error) {
    console.error('保存游客聊天记录失败:', error);
  }
}

// ============ 格式化 ============

/**
 * 格式化时间戳为可读字符串
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  // 一分钟内
  if (diff < 60 * 1000) {
    return '刚刚';
  }
  
  // 一小时内
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000));
    return `${minutes}分钟前`;
  }
  
  // 今天
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  
  // 昨天
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return '昨天 ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  
  // 其他
  return date.toLocaleDateString('zh-CN') + ' ' + 
         date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// ============ 验证 ============

/**
 * 验证用户名格式
 */
export function validateUsername(username: string): string | null {
  if (!username) {
    return '用户名不能为空';
  }
  if (username.length < 3) {
    return '用户名至少3个字符';
  }
  if (username.length > 20) {
    return '用户名最多20个字符';
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return '用户名只能包含字母、数字和下划线';
  }
  return null;
}

/**
 * 验证密码格式
 */
export function validatePassword(password: string): string | null {
  if (!password) {
    return '密码不能为空';
  }
  if (password.length < 6) {
    return '密码至少6个字符';
  }
  if (password.length > 50) {
    return '密码最多50个字符';
  }
  return null;
}

/**
 * 验证邮箱格式
 */
export function validateEmail(email: string): string | null {
  if (!email) {
    return null; // 邮箱可选
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return '邮箱格式不正确';
  }
  return null;
}

// ============ 防抖 ============

/**
 * 防抖函数
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  
  return function(this: any, ...args: Parameters<T>) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(this, args), delay);
  };
}

/**
 * 节流函数
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  
  return function(this: any, ...args: Parameters<T>) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      func.apply(this, args);
    }
  };
}

// ============ 图片处理 ============

/**
 * 将文件转换为 Base64
 */
export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * 压缩图片
 */
export async function compressImage(
  file: File,
  maxWidth: number = 1024,
  maxHeight: number = 1024,
  quality: number = 0.8
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        // 计算缩放比例
        if (width > height) {
          if (width > maxWidth) {
            height *= maxWidth / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width *= maxHeight / height;
            height = maxHeight;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('压缩图片失败'));
            }
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
