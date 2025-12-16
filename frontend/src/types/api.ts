/**
 * API 类型定义
 */

// 服务状态
export interface ServiceStatus {
  available: boolean;
  is_generating: boolean;
  is_generating_prompt: boolean;
}

// 生成 Prompt 请求
export interface GeneratePromptRequest {
  description: string;
}

export interface GeneratePromptResponse {
  success: boolean;
  prompt: string;
}

// 生成图像请求
export interface GenerateImageRequest {
  prompt: string;
  strength: number;
  lora_prompt?: string;
  count: number;
  workflow_type: string;
  reference_image?: string;
}

export interface GenerateImageResponse {
  success: boolean;
  images: string[];
  count: number;
}

// 上传图片响应
export interface UploadImageResponse {
  success: boolean;
  image: string;
}

// 工作流列表
export interface WorkflowsResponse {
  workflows: string[];
}

// WebSocket 消息类型
export interface WSMessage {
  type: 'state_change' | 'progress' | 'error' | 'result';
  field?: string;
  value?: any;
  data?: any;
}
