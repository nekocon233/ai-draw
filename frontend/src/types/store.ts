/**
 * Zustand Store 类型定义
 */
import type { ChatMessage, ServiceStatus, WorkflowType } from './models';

/**
 * 应用状态接口
 */
export interface AppState {
  // ============ 服务状态 ============
  isServiceAvailable: boolean;
  isGenerating: boolean;
  isGeneratingPrompt: boolean;
  
  // ============ 工作流配置 ============
  currentWorkflow: WorkflowType;
  prompt: string;
  loraPrompt: string;
  strength: number;
  count: number;
  imagesPerRow: number;
  referenceImage: string | null;
  
  // ============ 聊天历史 ============
  chatHistory: ChatMessage[];
  
  // ============ UI 状态 ============
  loading: boolean;
  error: string | null;
  
  // ============ Actions - 状态设置 ============
  setServiceStatus: (status: ServiceStatus) => void;
  setCurrentWorkflow: (workflow: WorkflowType) => Promise<void>;
  setPrompt: (prompt: string) => Promise<void>;
  setLoraPrompt: (prompt: string) => Promise<void>;
  setStrength: (strength: number) => Promise<void>;
  setCount: (count: number) => Promise<void>;
  setImagesPerRow: (count: number) => Promise<void>;
  setReferenceImage: (image: string | null) => Promise<void>;
  
  // ============ Actions - 聊天消息 ============
  addChatMessage: (
    prompt: string,
    workflow: string,
    strength: number | undefined,
    count: number,
    loraPrompt?: string,
    promptEnd?: string
  ) => Promise<string>; // 返回助手消息 ID
  
  updateChatImages: (messageId: string, images: string[]) => void;
  
  appendChatMedia: (messageId: string, image: string, index: number) => void;
  
  clearChatHistory: () => void;
  
  // ============ Actions - 数据加载 ============
  loadUserConfig: () => Promise<void>;
  
  saveUserConfig: () => Promise<void>;
  
  saveChatMessage: (message: ChatMessage) => Promise<void>;
  
  // ============ Actions - UI 状态 ============
  setLoading: (loading: boolean) => void;
  
  setError: (error: string | null) => void;
  
  clearError: () => void;
  
  stopGeneration: () => void;
  
  reset: () => void;
}

/**
 * 游客模式配置
 */
export interface GuestConfig {
  currentWorkflow: WorkflowType;
  prompt: string;
  loraPrompt: string;
  strength: number;
  count: number;
  imagesPerRow: number;
  referenceImage: string | null;
}
