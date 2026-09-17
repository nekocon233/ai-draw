/**
 * API 类型定义
 */

// 服务状态
export interface ServiceStatus {
  available: boolean;
  message?: string;
  is_generating?: boolean;
  is_generating_prompt?: boolean;
}

// 生成 Prompt 请求
export interface GeneratePromptRequest {
  description: string;
  workflow_id?: string;
}

export interface GeneratePromptResponse {
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
  frame_count?: number;  // i2v 总帧数
  // PixelLab 动画参数
  action?: string;
  view?: string;
  direction?: string;
  // Kling 首尾帧图生视频参数（kling_flf2v 专用）
  kling_options?: Record<string, WorkflowParameterValue>;
  workflow_options?: Record<string, WorkflowParameterValue>;
  // 任务关联（用于服务端落库与断线恢复）
  message_id?: string;       // 助手消息 ID（{user_msg_id}-reply）
  session_id?: string;       // 所属会话 ID
  task_id?: string;
}

// 最近一次生成任务快照（断线补拉用）
export interface LastTaskInfo {
  message_id: string | null;
  session_id: string | null;
  task_id?: string | null;
  user_id?: number | null;
  workflow?: string | null;
  status: 'running' | 'completed' | 'error';
  images: string[];
  error: string | null;
  finished_at: number | null;
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
export type WorkflowParameterValue = string | number;

export interface WorkflowParameter {
  name: string;
  label: string;
  type: 'number' | 'text' | 'select';
  min?: number;
  max?: number;
  step?: number;
  options?: string[];  // type === 'select' 时的可选项
  default: WorkflowParameterValue;
}

export interface WorkflowMetadata {
  key: string;
  label: string;
  description: string;
  requires_image: boolean;
  requires_end_image?: boolean;
  supports_optional_keyframes?: boolean;
  supports_original_size?: boolean;
  supports_loop?: boolean;
  output_type?: string;   // 'image' | 'video'
  category?: string;      // 工作流分组（同组在下拉折叠为一项，如 "图生图"）
  method?: string;        // 同组内具体方式名（设置弹窗中展示，如 "Q-Image"）
  supports_multi_image?: boolean;  // 是否支持多张参考图（图生图类目）
  parameters: WorkflowParameter[];
}

export interface WorkflowsResponse {
  workflows: WorkflowMetadata[];
  default_workflow: string;
}

// 以图生词（Gemini 分析单张图片风格/元素/动作/镜头 → 文生图提示词）
export interface AnalyzeImageForPromptRequest {
  image: string;        // data URL
  description: string;  // 指定要描述的内容（必填）
}

export interface AnalyzeImageForPromptResponse {
  prompt: string;
}

// 首尾帧分析（Gemini 分析 flf2v 首尾帧 → 过渡视频提示词）
export interface AnalyzeFramesForPromptRequest {
  image_start?: string;  // 首帧 data URL
  image_end?: string;    // 尾帧 data URL
  description?: string;  // 补充要求（可选）
  is_loop?: boolean;     // 是否循环（首尾帧往返）
}

export interface AnalyzeFramesForPromptResponse {
  prompt_start: string;  // 首帧描述提示词
  prompt_end: string;    // 尾帧描述提示词
}

// WebSocket 消息类型
export interface WSMessage {
  type: 'state_change' | 'progress' | 'error' | 'result' | 'initial_state';
  field?: string;
  value?: any;
  message_id?: string | null;
  session_id?: string | null;
  task_id?: string | null;
  data?: {
    is_generating?: boolean;
    is_generating_prompt?: boolean;
    is_service_available?: boolean;
    preview_items?: unknown[];
    last_task?: LastTaskInfo | null;
    [key: string]: unknown;
  };
}
