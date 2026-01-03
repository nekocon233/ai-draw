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
  workflow?: string;
  strength: number;
  lora_prompt?: string;
  count: number;
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
// 工作流元数据
export interface WorkflowParameter {
  name: string;
  label: string;
  type: 'number' | 'text';
  min?: number;
  max?: number;
  step?: number;
  default: string | number;
}

export interface WorkflowMetadata {
  key: string;
  label: string;
  description: string;
  requires_image: boolean;
  parameters: WorkflowParameter[];
}

export interface WorkflowsResponse {
  workflows: WorkflowMetadata[];
  default_workflow: string;
}

// WebSocket 消息类型
export interface WSMessage {
  type: 'state_change' | 'progress' | 'error' | 'result';
  field?: string;
  value?: any;
  data?: any;
}
