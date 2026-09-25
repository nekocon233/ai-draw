/**
 * 数据库模型类型定义
 */

// ============ 用户相关 ============

/**
 * 用户信息
 */
export interface User {
  id: number;
  username: string;
  created_at: string;
}

/**
 * 用户配置
 */
export interface UserConfig {
  current_workflow: string;
  prompt: string | null;
  lora_prompt: string | null;
  strength: number | null;
  count: number;
  images_per_row: number;
  current_session_id?: string;  // 当前选中的会话ID
  updated_at: string;
}

// ============ 聊天会话相关 ============

/**
 * 聊天会话配置（每个会话独立的设置）
 */
export interface SessionConfig {
  workflow: string;
  prompt: string;
  loraPrompt: string;
  strength: number;
  count: number;
  imagesPerRow: number;
  referenceImage: string | null;
  referenceImage2?: string | null;
  referenceImage3?: string | null;
  width?: number | null;
  height?: number | null;
  useOriginalSize?: boolean;
}

/**
 * 聊天会话（前端格式）
 */
export interface ChatSession {
  id: string;
  title: string;
  is_pinned: boolean;
  created_at: number;
  updated_at: number;
  message_count: number;
  config?: SessionConfig; // 会话配置（游客模式使用）
}

/**
 * 聊天会话（数据库格式）
 */
export interface DBChatSession {
  id: number;
  session_id: string;
  user_id: number;
  title: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

// ============ 聊天消息相关 ============

export interface ApiChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content?: string;
  images?: ChatMessage['images'];
  timestamp: number;
  params?: ChatMessage['params'];
}

/**
 * 聊天消息（前端格式）
 */
export interface ChatMessage {
  id: string;
  session_id: string; // 关联会话ID
  type: 'user' | 'assistant';
  content: string;
  images?: (string | { loading: true })[];
  timestamp: number;
  params?: {
    workflow: string;
    strength?: number;
    count?: number;
    loraPrompt?: string;
    width?: number;
    height?: number;
    useOriginalSize?: boolean;
    promptEnd?: string;
    referenceImage?: string;
    referenceImage2?: string;
    referenceImage3?: string;
    referenceImageEnd?: string;
    isLoop?: boolean;
    frameRate?: number;
    startFrameCount?: number;
    endFrameCount?: number;
    frameCount?: number;   // 历史视频总帧数（只读）
    workflowOptions?: Record<string, string | number>;
    motionReferenceImages?: string[];
    motionPrompt?: import('./api').MotionPromptSnapshot | null;
    promptPreset?: import('./api').PromptPreset;  // 所选预设快照，content 只含用户描述
  };
}

/**
 * 聊天消息（数据库格式）
 */
export interface DBChatMessage {
  id: number;
  session_id: string; // 关联会话ID
  user_id: number;
  message_id: string;
  type: 'user' | 'assistant';
  content: string;
  workflow?: string;
  strength?: number;
  count?: number;
  lora_prompt?: string;
  created_at: string;
}

/**
 * 生成的图片
 */
export interface GeneratedImage {
  id: number;
  message_id: string;
  image_index: number;
  file_path: string; // base64 或文件路径
  created_at: string;
}

// ============ 参考图相关 ============

/**
 * 参考图片
 */
export interface ReferenceImage {
  id: number;
  user_id: number;
  filename: string;
  file_path: string; // base64 数据
  uploaded_at: string;
  is_current: boolean;
}

// ============ 工作流相关 ============

/**
 * 工作流类型
 */
// 工作流类型 - 从后端动态获取
export type WorkflowType = string;

/**
 * 工作流配置
 */
export interface WorkflowConfig {
  name: string;
  type: WorkflowType;
  description: string;
  default_strength: number;
  supports_reference_image: boolean;
}

// ============ 服务状态相关 ============

/**
 * 服务状态
 */
export interface ServiceStatus {
  available: boolean;
  message: string;
  is_generating?: boolean;
  is_generating_prompt?: boolean;
}

// ============ WebSocket 消息相关 ============

/**
 * WebSocket 状态变化消息
 */
export type WSStateChangeMessage = import('./api').WSMessage & { type: 'state_change' };

/**
 * WebSocket 错误消息
 */
export interface WSErrorMessage {
  type: 'error';
  message: string;
}

export type { WSMessage } from './api';

// ============ API 响应相关 ============

/**
 * 通用成功响应
 */
export interface SuccessResponse {
  success: true;
  message?: string;
}

/**
 * 通用错误响应
 */
export interface ErrorResponse {
  success: false;
  message: string;
  detail?: string;
}

/**
 * 认证响应
 */
export interface AuthResponse {
  access_token: string;
  token_type: string;
}

/**
 * 媒体生成响应
 */
export type { GenerateMediaResponse } from './api';

/**
 * Prompt 生成响应
 */
export interface GeneratePromptResponse {
  prompt: string;
}

/**
 * 聊天历史响应
 */
export interface ChatHistoryResponse {
  messages: Array<{
    id: string;
    type: 'user' | 'assistant';
    content: string;
    timestamp: number;
    params?: {
      workflow: string;
      strength?: number;
      count?: number;
      loraPrompt?: string;
      isLoop?: boolean;
      frameRate?: number;
      startFrameCount?: number;
      endFrameCount?: number;
    };
    images?: string[];
  }>;
}

/**
 * 参考图响应
 */
export interface ReferenceImageResponse {
  image: string | null;
}
