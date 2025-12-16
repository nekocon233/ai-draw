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
  email?: string;
  created_at: string;
}

/**
 * 用户配置
 */
export interface UserConfig {
  current_workflow: string;
  prompt: string;
  lora_prompt: string;
  strength: number;
  count: number;
  images_per_row: number;
  updated_at: string;
}

// ============ 聊天消息相关 ============

/**
 * 聊天消息（前端格式）
 */
export interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  images?: (string | { loading: true })[];
  timestamp: number;
  params?: {
    workflow: string;
    strength: number;
    count: number;
    loraPrompt?: string;
  };
}

/**
 * 聊天消息（数据库格式）
 */
export interface DBChatMessage {
  id: number;
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
export type WorkflowType = '参考' | '上色' | '图生图' | '线稿';

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
export interface WSStateChangeMessage {
  type: 'state_change';
  field: 'is_generating' | 'image_generated' | 'preview_update' | 'generation_progress';
  value: any;
}

/**
 * WebSocket 错误消息
 */
export interface WSErrorMessage {
  type: 'error';
  message: string;
}

export type WSMessage = WSStateChangeMessage | WSErrorMessage;

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
 * 图片生成响应
 */
export interface GenerateImageResponse {
  count: number;
  images: string[];
}

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
      strength: number;
      count: number;
      loraPrompt?: string;
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
