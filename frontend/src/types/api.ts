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
  /** 所选预设原文，仅作扩写上下文，不会被扩写 */
  preset_prompt?: string;
}

export interface GeneratePromptResponse {
  prompt: string;
}

// 服务端维护的提示词预设
/** pose：原图场景与固定镜头；shot：参考里的人整个换成主体；face：只换脸和发型，保留参考人物的服装。 */
export type MotionReferenceMode = 'pose' | 'shot' | 'face';

export interface PromptPresetImage {
  label: string;
  role: string;
  slot?: 1 | 2 | 3 | 'end' | null;
}

export interface PromptPreset {
  id: string;
  title: string;
  description: string;
  prompt: string;
  output_type?: 'image' | 'video'; // Historical snapshots default to image presets.
  requires_motion_reference?: boolean;
  /** pose：原图场景与固定镜头；shot：主体图只取外观，镜头与动作跟随参考图。缺省为 pose。 */
  motion_reference_mode?: MotionReferenceMode;
  workflow_ids?: string[] | null;
  hint: string;  // 选中后作为输入框占位提示
  images: PromptPresetImage[];
}

export interface PromptPresetsResponse {
  presets: PromptPreset[];
}

// A missing key is uninitialized; null records an explicit opt-out for that workflow.
export type PromptPresetChoices = Record<string, PromptPreset | null>;

// 生成媒体请求
export interface MotionPromptSnapshot {
  version: 1;
  input_hash: string;
  prompt: string;
}

export interface GenerateMediaRequest {
  append_results?: boolean;
  prompt: string;
  workflow?: string;
  strength?: number;
  lora_prompt?: string;
  count: number;
  reference_image?: string;
  reference_image_2?: string;  // 第 2 张参考图
  reference_image_3?: string;  // 第 3 张参考图
  // 有序参考图槽位（含空位）；优先于上面三个 legacy 字段，上限由工作流元数据 max_reference_images 决定
  reference_images?: (string | null)[];
  motion_reference_images?: string[];
  /** 已上传的动作视频（/uploads/reference/...mp4），与 motion_reference_images 二选一 */
  motion_reference_video?: string;
  motion_prompt?: MotionPromptSnapshot;
  width?: number;
  height?: number;
  reference_image_end?: string;
  use_original_size?: boolean;
  // PixelLab 动画参数
  action?: string;
  view?: string;
  direction?: string;
  workflow_options?: Record<string, WorkflowParameterValue>;
  prompt_preset?: PromptPreset;  // 所选预设快照，生成时拼在 prompt 前面
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
  phase?: 'reserved' | 'running' | 'persisting' | 'completed' | 'error' | 'cancelled';
  images: string[];
  /** Parallel to images once the task completes. */
  seeds?: (number | null)[];
  error: string | null;
  finished_at: number | null;
}

export interface GenerateMediaResponse {
  task_id: string;
  images: string[];
  count: number;
}

// 会话轮次摘要：结果区导航条据此预览和定位尚未加载的旧轮次
export interface SessionOutlineRound {
  id: string;               // 用户消息 ID
  timestamp: number;
  content: string;          // 用户描述，服务端截断
  preset_title?: string | null;
  workflow?: string | null;
  media: string[];          // 前几个可展示的结果 URL
  media_count: number;
}

// 上传图片响应
export interface UploadImageResponse {
  success: boolean;
  image: string;
}

// 动作视频上传：服务端截取开头，转成无声 24fps H.264 后保存
export interface UploadMotionVideoResponse {
  url: string;
  duration: number;
  frames: number;
  width: number;
  height: number;
  source_duration: number;
  trimmed: boolean;
}

// 工作流列表
// 工作流元数据
export type WorkflowParameterValue = string | number;

export interface WorkflowParameter {
  option_labels?: Record<string, string>;
  name: string;
  label: string;
  type: 'number' | 'text' | 'select' | 'seed';  // seed: '' 为随机，整数为固定种子
  min?: number;
  max?: number;
  step?: number;
  options?: string[];  // type === 'select' 时的可选项
  default: WorkflowParameterValue;
}

export interface WorkflowMetadata {
  default_prompt_preset_id?: string | null;
  method_group?: string | null;
  text_workflow?: string | null;
  image_workflow?: string | null;
  reference_image_label?: string;
  reference_image_description?: string | null;
  key: string;
  label: string;
  description: string;
  requires_image: boolean;
  requires_end_image?: boolean;
  supports_optional_keyframes?: boolean;
  supports_motion_reference?: boolean;
  motion_reference_mode?: MotionReferenceMode;  // 工作流固有的参考模式（换脸工作流固定 face）；无预设时前后端都以它为准
  max_motion_reference_images?: number;
  supports_motion_reference_video?: boolean;  // 动作参考可改用一段视频，时长跟随视频
  max_motion_reference_video_seconds?: number;
  supports_original_size?: boolean;
  output_type?: string;   // 'image' | 'video'
  category?: string;      // 工作流分组（同组在下拉折叠为一项，如 "图生图"）
  method?: string;        // 同组内具体方式名（设置弹窗中展示）
  supports_multi_image?: boolean;  // 是否支持多张参考图（图生图类目）
  max_reference_images?: number;   // 多参考图工作流的槽位上限（缺省 3）
  max_count?: number;
  lora_labels?: Record<string, string>;  // LoRA 标识 → 登记的显示名称
  parameters: WorkflowParameter[];
}

export interface WorkflowsResponse {
  workflows: WorkflowMetadata[];
  default_workflow: string;
}

export interface LoraModelOption {
  value: string;
  label: string;
  default_strength: number;
}

export interface LoraModelsResponse {
  workflow: string;
  models: LoraModelOption[];
}

// 以图生词（LLM 分析单张图片风格/元素/动作/镜头 → 文生图提示词）
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
  value?: unknown;
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
