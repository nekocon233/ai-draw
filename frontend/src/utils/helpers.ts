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
 * 加载游客会话列表
 */
export function loadGuestSessions(): any[] {
  try {
    const saved = localStorage.getItem('guestSessions');
    return saved ? JSON.parse(saved) : [];
  } catch (error) {
    console.error('加载游客会话列表失败:', error);
    return [];
  }
}

/**
 * 保存游客会话列表
 */
export function saveGuestSessions(sessions: any[]): void {
  try {
    localStorage.setItem('guestSessions', JSON.stringify(sessions));
  } catch (error) {
    console.error('保存游客会话列表失败:', error);
  }
}



/**
 * 加载指定游客会话的聊天记录
 */
export function loadGuestSessionHistory(sessionId: string): any[] {
  try {
    const saved = localStorage.getItem(`guestSession_${sessionId}`);
    const messages = saved ? JSON.parse(saved) : [];
    return messages.map((msg: any) => {
      if (msg?.type === 'assistant' && Array.isArray(msg.images)) {
        return {
          ...msg,
          images: msg.images.map((img: any, idx: number) => {
            if (typeof img === 'string' && img.startsWith('indexeddb://')) {
              return { storage: 'indexeddb', index: idx };
            }
            return img;
          }),
        };
      }
      return msg;
    });
  } catch (error) {
    console.error('加载游客会话聊天记录失败:', error);
    return [];
  }
}

/**
 * 从 IndexedDB 恢复会话的图片数据
 * 注意：这是一个异步函数，需要在加载会话后调用
 */
export async function restoreSessionImages(sessionId: string, messages: any[]): Promise<any[]> {
  try {
    const { loadSessionImages } = await import('./indexedDB');
    const imageMap = await loadSessionImages(sessionId);
    
    // 将图片数据恢复到消息中
    return messages.map(msg => {
      if (msg.type === 'assistant' && msg.images && msg.images.length > 0) {
        const realImages = imageMap.get(msg.id);
        if (realImages && realImages.length > 0) {
          // 有实际图片数据，恢复它们
          return { ...msg, images: realImages };
        }
        // 没有找到图片数据，检查是否是占位符
        const hasPlaceholders = msg.images.some((img: any) => 
          (typeof img === 'string' && img.startsWith('indexeddb://')) ||
          (typeof img === 'object' && img && img.storage === 'indexeddb')
        );
        if (hasPlaceholders) {
          // 有占位符但没找到数据，移除占位符避免显示错误
          console.warn(`消息 ${msg.id} 的图片数据在 IndexedDB 中未找到`);
          return { ...msg, images: [] };
        }
      }
      return msg;
    });
  } catch (error) {
    console.error('从 IndexedDB 恢复图片失败:', error);
    // 失败时移除所有占位符
    return messages.map(msg => {
      if (msg.type === 'assistant' && msg.images) {
        const filteredImages = msg.images.filter((img: any) => 
          !(
            (typeof img === 'string' && img.startsWith('indexeddb://')) ||
            (typeof img === 'object' && img && img.storage === 'indexeddb')
          )
        );
        return { ...msg, images: filteredImages };
      }
      return msg;
    });
  }
}

/**
 * 限制历史记录数量（保留最新的 N 条）
 * @param messages 消息列表
 * @param maxMessages 最大保留数量（默认 100 条消息，约 50 轮对话）
 * @returns 截取后的消息列表
 */
function limitMessageHistory(messages: any[], maxMessages: number = 100): any[] {
  if (messages.length <= maxMessages) {
    return messages;
  }
  // 保留最新的消息
  return messages.slice(-maxMessages);
}

/**
 * 保存指定游客会话的聊天记录
 * 注意：图片数据存储在 IndexedDB 中，这里只保存元数据
 */
export function saveGuestSessionHistory(sessionId: string, messages: any[]): void {
  try {
    // 1. 限制历史记录数量
    let filteredMessages = limitMessageHistory(messages, 100);
    
    // 2. 移除 base64 图片数据，使用占位符（图片存储在 IndexedDB）
    const messagesWithoutImages = filteredMessages.map(msg => {
      if (msg.type === 'assistant' && msg.images) {
        // 将实际的图片替换为占位符，保留加载状态
        return {
          ...msg,
          images: msg.images.map((img: any, idx: number) => {
            // 如果是字符串（实际图片数据），替换为占位符
            if (typeof img === 'string') {
              return { storage: 'indexeddb', index: idx };
            }
            // 保留加载状态对象
            return img;
          })
        };
      }
      return msg;
    });
    
    // 3. 保存到 localStorage（现在体积小多了）
    localStorage.setItem(`guestSession_${sessionId}`, JSON.stringify(messagesWithoutImages));
  } catch (error) {
    console.error('保存游客会话聊天记录失败:', error);
    
    // 如果是配额错误，尝试清理旧数据后重试
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      console.warn('localStorage 配额已满，尝试减少历史记录...');
      try {
        // 只保留最近 20 条消息
        const minimalMessages = limitMessageHistory(messages, 20).map(msg => {
          if (msg.type === 'assistant' && msg.images) {
            return {
              ...msg,
              images: msg.images.map((img: any, idx: number) => {
                if (typeof img === 'string') {
                  return { storage: 'indexeddb', index: idx };
                }
                return img;
              })
            };
          }
          return msg;
        });
        localStorage.setItem(`guestSession_${sessionId}`, JSON.stringify(minimalMessages));
        console.info('已减少历史记录并重新保存');
      } catch (retryError) {
        console.error('清理后仍无法保存，放弃保存:', retryError);
      }
    }
  }
}

/**
 * 删除游客会话
 */
export function deleteGuestSession(sessionId: string): void {
  try {
    localStorage.removeItem(`guestSession_${sessionId}`);
    const sessions = loadGuestSessions().filter(s => s.id !== sessionId);
    saveGuestSessions(sessions);
    
    // 同时删除 IndexedDB 中的图片数据
    import('./indexedDB').then(({ deleteSessionImages }) => {
      deleteSessionImages(sessionId).catch(err => 
        console.error('删除会话图片失败:', err)
      );
    });
  } catch (error) {
    console.error('删除游客会话失败:', error);
  }
}

/**
 * 清理所有游客会话数据（用于释放存储空间）
 */
export function clearAllGuestData(): void {
  try {
    const sessions = loadGuestSessions();
    sessions.forEach(session => {
      localStorage.removeItem(`guestSession_${session.id}`);
    });
    localStorage.removeItem('guestSessions');
    localStorage.removeItem(STORAGE_KEYS.GUEST_CONFIG);
    
    // 同时清理 IndexedDB
    import('./indexedDB').then(({ clearAllData }) => {
      clearAllData()
        .then(() => console.info('已清理所有游客数据（包括 IndexedDB）'))
        .catch(err => console.error('清理 IndexedDB 失败:', err));
    });
  } catch (error) {
    console.error('清理游客数据失败:', error);
  }
}

/**
 * 获取 localStorage 使用情况
 */
export function getStorageUsage(): { used: number; total: number; percentage: number } {
  try {
    let used = 0;
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        used += localStorage[key].length + key.length;
      }
    }
    
    // localStorage 通常限制 5-10MB，这里假设 5MB
    const total = 5 * 1024 * 1024;
    const percentage = (used / total) * 100;
    
    return { used, total, percentage };
  } catch (error) {
    console.error('获取存储使用情况失败:', error);
    return { used: 0, total: 5 * 1024 * 1024, percentage: 0 };
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

// ============ 会话配置管理（游客模式）============

/**
 * 加载游客会话配置
 */
export function loadGuestSessionConfig(sessionId: string): any {
  try {
    const data = localStorage.getItem(`guestSessionConfig_${sessionId}`);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('加载会话配置失败:', error);
    return null;
  }
}

/**
 * 保存游客会话配置
 */
export function saveGuestSessionConfig(sessionId: string, config: any): void {
  try {
    localStorage.setItem(`guestSessionConfig_${sessionId}`, JSON.stringify(config));
  } catch (error) {
    console.error('保存会话配置失败:', error);
  }
}

/**
 * 删除游客会话配置
 */
export function deleteGuestSessionConfig(sessionId: string): void {
  try {
    localStorage.removeItem(`guestSessionConfig_${sessionId}`);
  } catch (error) {
    console.error('删除会话配置失败:', error);
  }
}
