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
  workflow_id?: string;
}

export interface GeneratePromptResponse {
  success: boolean;
  prompt: string;
}

// 生成媒体请求
export interface GenerateMediaRequest {
  prompt: string;
  workflow?: string;
  strength?: number;
  lora_prompt?: string;
  count: number;
  reference_image?: string;
  reference_image_2?: string;  // i2i 第 2 张参考图
  reference_image_3?: string;  // i2i 第 3 张参考图
  width?: number;
  height?: number;
  prompt_end?: string;
  reference_image_end?: string;
  use_original_size?: boolean;
  is_loop?: boolean;
  start_frame_count?: number;
  end_frame_count?: number;
  frame_rate?: number;
  // Gemini 多轮对话（nano_banana_pro 专用）
  send_history?: boolean;
  session_id?: string;
}

export interface GenerateMediaResponse {
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
  requires_end_image?: boolean;
  supports_original_size?: boolean;
  supports_loop?: boolean;
  output_type?: string;   // 'image' | 'video'
  parameters: WorkflowParameter[];
}

export interface WorkflowsResponse {
  workflows: WorkflowMetadata[];
  default_workflow: string;
}

// 姿势反推
export interface AnalyzePoseRequest {
  images: string[];
}

export interface AnalyzePoseResponse {
  prompt: string;
}

// 以图生词（Gemini 分析图片风格/元素/动作/镜头 → 文生图提示词）
export interface AnalyzeImageForPromptRequest {
  image: string;        // data URL
  description: string;  // 指定要描述的内容（必填）
}

export interface AnalyzeImageForPromptResponse {
  prompt: string;
}

// WebSocket 消息类型
export interface WSMessage {
  type: 'state_change' | 'progress' | 'error' | 'result' | 'initial_state';
  field?: string;
  value?: any;
  data?: any;
}
