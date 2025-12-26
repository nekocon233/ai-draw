/**
 * IndexedDB 工具模块
 * 
 * 用于游客模式下存储大量图片数据，突破 localStorage 的容量限制
 */

const DB_NAME = 'AiDrawDB';
const DB_VERSION = 1;
const STORE_NAME = 'images';

interface ImageRecord {
  id: string; // 组合键: `${sessionId}_${messageId}_${index}`
  sessionId: string;
  messageId: string;
  index: number;
  imageData: string; // base64 图片数据
  timestamp: number;
}

/**
 * 打开数据库连接
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // 创建对象存储（如果不存在）
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        
        // 创建索引
        objectStore.createIndex('sessionId', 'sessionId', { unique: false });
        objectStore.createIndex('messageId', 'messageId', { unique: false });
        objectStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

/**
 * 保存图片到 IndexedDB
 * 
 * @param sessionId 会话 ID
 * @param messageId 消息 ID
 * @param imageData base64 图片数据
 * @param index 图片索引
 */
export async function saveImage(
  sessionId: string,
  messageId: string,
  imageData: string,
  index: number
): Promise<void> {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const objectStore = transaction.objectStore(STORE_NAME);
    
    const record: ImageRecord = {
      id: `${sessionId}_${messageId}_${index}`,
      sessionId,
      messageId,
      index,
      imageData,
      timestamp: Date.now(),
    };
    
    const request = objectStore.put(record);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    
    transaction.oncomplete = () => db.close();
  });
}

/**
 * 批量保存图片
 * 
 * @param sessionId 会话 ID
 * @param messageId 消息 ID
 * @param images 图片数据数组
 */
export async function saveImages(
  sessionId: string,
  messageId: string,
  images: string[]
): Promise<void> {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const objectStore = transaction.objectStore(STORE_NAME);
    
    let completed = 0;
    let hasError = false;
    
    images.forEach((imageData, index) => {
      if (typeof imageData !== 'string' || !imageData) return;
      
      const record: ImageRecord = {
        id: `${sessionId}_${messageId}_${index}`,
        sessionId,
        messageId,
        index,
        imageData,
        timestamp: Date.now(),
      };
      
      const request = objectStore.put(record);
      
      request.onsuccess = () => {
        completed++;
        if (completed === images.filter(img => typeof img === 'string' && img).length) {
          resolve();
        }
      };
      
      request.onerror = () => {
        if (!hasError) {
          hasError = true;
          reject(request.error);
        }
      };
    });
    
    transaction.oncomplete = () => db.close();
  });
}

/**
 * 加载指定消息的所有图片
 * 
 * @param sessionId 会话 ID
 * @param messageId 消息 ID
 * @returns 图片数据数组（按 index 排序）
 */
export async function loadMessageImages(
  sessionId: string,
  messageId: string
): Promise<string[]> {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const objectStore = transaction.objectStore(STORE_NAME);
    const index = objectStore.index('messageId');
    
    const request = index.getAll(messageId);
    
    request.onsuccess = () => {
      const records = request.result as ImageRecord[];
      
      // 过滤当前会话的记录并按 index 排序
      const filteredRecords = records
        .filter(r => r.sessionId === sessionId)
        .sort((a, b) => a.index - b.index);
      
      const images = filteredRecords.map(r => r.imageData);
      resolve(images);
    };
    
    request.onerror = () => reject(request.error);
    
    transaction.oncomplete = () => db.close();
  });
}

/**
 * 加载指定会话的所有图片（按消息分组）
 * 
 * @param sessionId 会话 ID
 * @returns Map<messageId, 图片数组>
 */
export async function loadSessionImages(
  sessionId: string
): Promise<Map<string, string[]>> {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const objectStore = transaction.objectStore(STORE_NAME);
    const index = objectStore.index('sessionId');
    
    const request = index.getAll(sessionId);
    
    request.onsuccess = () => {
      const records = request.result as ImageRecord[];
      
      // 按 messageId 分组
      const imageMap = new Map<string, string[]>();
      
      records.forEach(record => {
        if (!imageMap.has(record.messageId)) {
          imageMap.set(record.messageId, []);
        }
        
        const images = imageMap.get(record.messageId)!;
        images[record.index] = record.imageData;
      });
      
      resolve(imageMap);
    };
    
    request.onerror = () => reject(request.error);
    
    transaction.oncomplete = () => db.close();
  });
}

/**
 * 删除指定会话的所有图片
 * 
 * @param sessionId 会话 ID
 */
export async function deleteSessionImages(sessionId: string): Promise<void> {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const objectStore = transaction.objectStore(STORE_NAME);
    const index = objectStore.index('sessionId');
    
    const request = index.openCursor(IDBKeyRange.only(sessionId));
    
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    
    request.onerror = () => reject(request.error);
    
    transaction.oncomplete = () => db.close();
  });
}

/**
 * 删除指定消息的所有图片
 * 
 * @param sessionId 会话 ID
 * @param messageId 消息 ID
 */
export async function deleteMessageImages(
  sessionId: string,
  messageId: string
): Promise<void> {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const objectStore = transaction.objectStore(STORE_NAME);
    const index = objectStore.index('messageId');
    
    const request = index.openCursor(IDBKeyRange.only(messageId));
    
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        const record = cursor.value as ImageRecord;
        if (record.sessionId === sessionId) {
          cursor.delete();
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    
    request.onerror = () => reject(request.error);
    
    transaction.oncomplete = () => db.close();
  });
}

/**
 * 获取 IndexedDB 使用情况（估算）
 * 
 * @returns 使用的字节数
 */
export async function getStorageUsage(): Promise<number> {
  if (!navigator.storage || !navigator.storage.estimate) {
    return 0;
  }
  
  try {
    const estimate = await navigator.storage.estimate();
    return estimate.usage || 0;
  } catch (error) {
    console.error('获取存储使用情况失败:', error);
    return 0;
  }
}

/**
 * 清理所有数据（谨慎使用）
 */
export async function clearAllData(): Promise<void> {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const objectStore = transaction.objectStore(STORE_NAME);
    
    const request = objectStore.clear();
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    
    transaction.oncomplete = () => db.close();
  });
}

/**
 * 清理旧数据（超过指定天数）
 * 
 * @param daysOld 保留最近多少天的数据
 */
export async function cleanupOldData(daysOld: number = 30): Promise<number> {
  const db = await openDB();
  const cutoffTime = Date.now() - daysOld * 24 * 60 * 60 * 1000;
  let deletedCount = 0;
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const objectStore = transaction.objectStore(STORE_NAME);
    const index = objectStore.index('timestamp');
    
    const request = index.openCursor(IDBKeyRange.upperBound(cutoffTime));
    
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        cursor.delete();
        deletedCount++;
        cursor.continue();
      } else {
        resolve(deletedCount);
      }
    };
    
    request.onerror = () => reject(request.error);
    
    transaction.oncomplete = () => db.close();
  });
}

/**
 * 调试工具：列出所有存储的图片记录
 * 在浏览器控制台调用：window.debugIndexedDB()
 */
export async function debugListAllImages(): Promise<ImageRecord[]> {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const objectStore = transaction.objectStore(STORE_NAME);
    const request = objectStore.getAll();
    
    request.onsuccess = () => {
      const records = request.result as ImageRecord[];
      console.log(`IndexedDB 中共有 ${records.length} 条图片记录:`);
      
      // 按会话分组统计
      const sessionStats = new Map<string, number>();
      records.forEach(record => {
        sessionStats.set(record.sessionId, (sessionStats.get(record.sessionId) || 0) + 1);
      });
      
      console.table(Array.from(sessionStats.entries()).map(([sessionId, count]) => ({
        sessionId,
        imageCount: count
      })));
      
      resolve(records);
    };
    
    request.onerror = () => reject(request.error);
    
    transaction.oncomplete = () => db.close();
  });
}

// 将调试函数暴露到全局（仅开发环境）
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as any).debugIndexedDB = debugListAllImages;
}
