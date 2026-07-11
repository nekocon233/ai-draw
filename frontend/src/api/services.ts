/**
 * API 服务方法
 */
import client from './client';
import type {
  ServiceStatus,
  GeneratePromptRequest,
  GeneratePromptResponse,
  AnalyzeImageForPromptRequest,
  AnalyzeImageForPromptResponse,
  AnalyzeFramesForPromptRequest,
  AnalyzeFramesForPromptResponse,
  GenerateMediaRequest,
  GenerateMediaResponse,
  UploadImageResponse,
  WorkflowsResponse,
} from '../types/api';
import type { ChatSession } from '../types/models';

import type { AuthResponse, UserConfig } from '../types/models';

export type VideoBackgroundMode = 'none' | 'ai' | 'inspyrenet' | 'birefnet' | 'edge';
export type VideoFrameExportOutput = 'zip' | 'spritesheet' | 'gif' | 'apng';
export type ImageUpscaleMethodId = 'lanczos' | 'apisr' | 'real_cugan' | 'realesrgan_general' | 'realesrgan_anime' | 'invsr';

export interface ImageUpscaleScaleAvailability {
  scale: 2 | 4;
  available: boolean;
  unavailable_reason?: string | null;
  model?: string | null;
  native_scale: number;
  processing_scale: number;
}

export interface ImageUpscaleMethod {
  id: ImageUpscaleMethodId;
  algorithm_id: string;
  algorithm_name: string;
  label: string;
  description: string;
  architecture: string;
  behavior: string;
  license_notice?: string | null;
  kind: 'local' | 'ai';
  available: boolean;
  supported_scales: Array<2 | 4>;
  scale_availability: ImageUpscaleScaleAvailability[];
  unavailable_reason?: string | null;
}

export interface ImageUpscaleMethodsResponse {
  methods: ImageUpscaleMethod[];
  scales: Array<2 | 4>;
  max_edge: number;
  max_pixels: number;
}

export interface ImageUpscaleResponse {
  success: boolean;
  image_url: string;
  width: number;
  height: number;
  method: ImageUpscaleMethodId;
  algorithm: string;
  scale: 2 | 4;
}

export interface ImageUpscaleBatchResponse {
  success: boolean;
  method: ImageUpscaleMethodId;
  scale: 2 | 4;
  frames: Array<{
    source_url: string;
    image_url: string;
    width: number;
    height: number;
  }>;
}

interface WorkflowDefaultsResponse {
  success: boolean;
  defaults: {
    workflow_metadata?: Record<string, {
      parameters?: Array<{ name: string; default?: unknown }>;
    }>;
  };
}

export interface VideoBackgroundOptions {
  background_mode?: VideoBackgroundMode;
  rembg_model?: string;
  alpha_matting?: boolean;
  alpha_matting_foreground_threshold?: number;
  alpha_matting_background_threshold?: number;
  alpha_matting_erode_size?: number;
  post_process_mask?: boolean;
  inspyrenet_mode?: 'base' | 'fast' | 'base-nightly';
  inspyrenet_resize?: 'static' | 'dynamic';
  birefnet_model?: string;
  birefnet_image_size?: number;
  birefnet_device?: string;
  birefnet_precision?: 'auto' | 'fp32' | 'fp16' | 'bf16';
  edge_threshold?: number;
  edge_feather?: number;
}

export interface VideoFramePreviewItem {
  index: number;
  url: string;
  width: number;
  height: number;
  time?: number | null;
}

export interface VideoFramePreviewResponse {
  success: boolean;
  preview_id: string;
  frames: VideoFramePreviewItem[];
  width: number;
  height: number;
  source_fps?: number | null;
  source_duration?: number | null;
}

export interface VideoMetaResponse {
  success: boolean;
  source_fps?: number | null;
  source_duration?: number | null;
}

export interface VideoFrameExportResponse {
  success: boolean;
  output?: VideoFrameExportOutput;
  frames: number;
  background_mode?: VideoBackgroundMode;
  spritesheet_url?: string;
  apng_url?: string;
  gif_url?: string;
  zip_url?: string;
  cols?: number;
  rows?: number;
  width?: number;
  height?: number;
  sheet_width?: number;
  sheet_height?: number;
  duration_ms?: number;
}

export interface VideoFrameBackgroundBatchResponse {
  success: boolean;
  background_mode: VideoBackgroundMode;
  frames: Array<{ source_url: string; image_url: string }>;
}

export interface VideoFrameExportProgress {
  progress_id: string;
  stage: string;
  percent: number;
  message: string;
  current?: number | null;
  total?: number | null;
  done?: boolean;
  error?: string | null;
}

export const apiService = {
  // 用户认证
  register: (data: { username: string; password: string; invite_code: string }): Promise<AuthResponse> =>
    client.post('/auth/register', data),
  
  login: (data: { username: string; password: string }): Promise<AuthResponse> =>
    client.post('/auth/login', data),
  
  // 用户配置
  getUserConfig: (): Promise<UserConfig> =>
    client.get('/config/user'),
  
  updateUserConfig: (data: Partial<UserConfig>): Promise<{ message: string }> =>
    client.post('/config/user', data),
  
  resetUserConfig: (): Promise<{ message: string }> =>
    client.delete('/config/user'),
  
  // 会话管理
  getSessions: (): Promise<ChatSession[]> =>
    client.get('/chat/sessions'),
  
  createSession: (title?: string): Promise<{ session_id: string; title: string; is_pinned: boolean; created_at: number; updated_at: number }> =>
    client.post('/chat/sessions', { session_id: `session-${Date.now()}`, title: title || '新对话' }),
  
  deleteSession: (sessionId: string): Promise<{ message: string }> =>
    client.delete(`/chat/sessions/${sessionId}`),

  deleteMessage: (sessionId: string, messageId: string): Promise<{ deleted: boolean }> =>
    client.delete(`/chat/sessions/${sessionId}/messages/${messageId}`),

  updateMessageContent: (messageId: string, data: {
    content?: string;
    reference_image?: string | null;
    reference_image_2?: string | null;
    reference_image_3?: string | null;
  }): Promise<{ updated: boolean }> =>
    client.patch(`/chat/messages/${messageId}`, data),

  updateSessionTitle: (sessionId: string, title: string): Promise<{ message: string }> =>
    client.put(`/chat/sessions/${sessionId}`, { title }),

  updateSessionPin: (sessionId: string, isPinned: boolean): Promise<{ is_pinned: boolean }> =>
    client.patch(`/chat/sessions/${sessionId}/pin`, { is_pinned: isPinned }),

  summarizeSessionTitle: (sessionId: string): Promise<{ title: string }> =>
    client.post(`/chat/sessions/${sessionId}/summarize-title`),
  
  // 会话配置
  getSessionConfig: (sessionId: string): Promise<{
    workflow: string;
    prompt: string;
    lora_prompt: string;
    strength: number;
    count: number;
    images_per_row: number;
    reference_image: string | null;
    reference_image_2?: string | null;
    reference_image_3?: string | null;
    prompt_end?: string | null;
    reference_image_end?: string | null;
    is_loop?: boolean;
    start_frame_count?: number | null;
    end_frame_count?: number | null;
    frame_rate?: number | null;
    frame_count?: number | null;
  }> =>
    client.get(`/chat/sessions/${sessionId}/config`),
  
  updateSessionConfig: (sessionId: string, config: {
    workflow?: string;
    prompt?: string;
    lora_prompt?: string;
    strength?: number;
    count?: number;
    images_per_row?: number;
    reference_image?: string | null;
    reference_image_2?: string | null;
    reference_image_3?: string | null;
    prompt_end?: string | null;
    reference_image_end?: string | null;
    is_loop?: boolean;
    start_frame_count?: number;
    end_frame_count?: number;
    frame_rate?: number;
    frame_count?: number;
  }): Promise<{ message: string }> =>
    client.put(`/chat/sessions/${sessionId}/config`, config),
  
  // 聊天历史
  getChatHistory: (limit?: number, sessionId?: string, offset?: number): Promise<{ messages: unknown[]; has_more?: boolean }> =>
    client.get('/chat/history', { params: { limit, offset, session_id: sessionId } }),
  
  saveChatMessage: (data: {
    session_id: string;
    message_id: string;
    type: 'user' | 'assistant';
    content: string;
    workflow?: string;
    strength?: number;
    count?: number;
    lora_prompt?: string;
    images?: string[];
    reference_image?: string;
    reference_image_2?: string;
    reference_image_3?: string;
    reference_image_end?: string;
    prompt_end?: string;
    frame_rate?: number;
    start_frame_count?: number;
    end_frame_count?: number;
    frame_count?: number;
  }): Promise<{ message: string }> =>
    client.post('/chat/save', data),
  
  clearChatHistory: (): Promise<{ message: string }> =>
    client.delete('/chat/history'),
  
  // 参考图
  saveReferenceImage: (data: { image: string; filename?: string }): Promise<{ message: string }> =>
    client.post('/reference-image', data),
  
  getReferenceImage: (): Promise<{ image: string | null }> =>
    client.get('/reference-image'),
  
  clearReferenceImage: (): Promise<{ message: string }> =>
    client.delete('/reference-image'),
  
  // 服务状态
  getServiceStatus: (): Promise<ServiceStatus> => 
    client.get('/service/status'),
  
  startService: (): Promise<{ message: string }> => 
    client.post('/service/start'),
  
  stopService: (): Promise<{ message: string }> =>
    client.post('/service/stop'),
  
  // Prompt 生成
  generatePrompt: (data: GeneratePromptRequest): Promise<GeneratePromptResponse> =>
    client.post('/prompt/generate', data),

  // Gemini 以图生词（分析单张图片风格/元素/动作/镜头 → 文生图提示词）
  analyzeImageForPrompt: (data: AnalyzeImageForPromptRequest): Promise<AnalyzeImageForPromptResponse> =>
    client.post('/prompt/analyze-image', data),

  // Gemini 首尾帧分析 → flf2v 视频过渡提示词
  analyzeFramesForPrompt: (data: AnalyzeFramesForPromptRequest): Promise<AnalyzeFramesForPromptResponse> =>
    client.post('/prompt/analyze-frames', data),

  // 获取姿势迁移预设提示词（与后端同源）
  getPosePreset: (): Promise<{ prompt: string }> =>
    client.get('/prompt/pose-preset'),
  
  // 媒体生成
  generateMedia: (data: GenerateMediaRequest): Promise<GenerateMediaResponse> =>
    client.post('/media/generate', data, {
      timeout: 300000 // 5 分钟，因为生成多张图片耗时较长
    }),

  stopGeneration: (): Promise<{ success: boolean; message: string }> =>
    client.post('/media/stop'),
  
  // 媒体上传
  uploadImage: (file: File): Promise<UploadImageResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    return client.post('/media/upload-reference', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },

  // 视频 → 透明精灵图（单张网格 PNG）
  videoToSpritesheet: (data: {
    video_url: string;
    rows?: number;
    start_time?: number;
    end_time?: number;
  } & VideoBackgroundOptions): Promise<{ success: boolean; spritesheet_url: string; frames: number; cols: number; rows: number; background_mode: VideoBackgroundMode }> =>
    client.post('/media/video-to-spritesheet', data, {
      timeout: 300000, // rembg 逐帧抠图较慢，5 分钟
    }),

  // 单图 → 移除背景（透明 PNG），复用视频抽帧那套抠图逻辑
  removeBackground: (data: {
    image_url: string;
  } & VideoBackgroundOptions): Promise<{ success: boolean; image_url: string; background_mode: VideoBackgroundMode }> =>
    client.post('/media/remove-background', data, {
      timeout: 300000,
    }),

  // 视频 → 预览帧（独立编辑器使用）
  videoFramePreview: (data: {
    video_url: string;
    start_time?: number;
    end_time?: number;
    fps?: number;
    max_frames?: number;
  }): Promise<VideoFramePreviewResponse> =>
    client.post('/media/video-frame-preview', data, {
      timeout: 300000,
    }),

  // 视频元信息探测（ffprobe，仅帧率/时长，不抽帧）
  getVideoMeta: (data: { video_url: string }): Promise<VideoMetaResponse> =>
    client.post('/media/video-meta', data, {
      timeout: 30000,
    }),

  // 批量帧 → 移除背景（工作台编辑与整理步骤使用）
  removeVideoFrameBackgrounds: (data: {
    frame_urls: string[];
  } & VideoBackgroundOptions): Promise<VideoFrameBackgroundBatchResponse> =>
    client.post('/media/video-frame-backgrounds', data, {
      timeout: 300000,
    }),

  // 保存 canvas 编辑帧
  saveEditedVideoFrame: (data: {
    image: string;
    base_frame_url?: string;
    preview_id?: string;
  }): Promise<{ success: boolean; image_url: string; width: number; height: number }> =>
    client.post('/media/video-frame-edited', data, {
      timeout: 300000,
    }),

  getImageUpscaleMethods: (): Promise<ImageUpscaleMethodsResponse> =>
    client.get('/media/image-upscale-methods', {
      timeout: 15000,
    }),

  upscaleImage: (data: {
    image: string;
    method: ImageUpscaleMethodId;
    scale: 2 | 4;
  }): Promise<ImageUpscaleResponse> =>
    client.post('/media/image-upscale', data, {
      timeout: 600000,
    }),

  upscaleImageBatch: (data: {
    frame_urls: string[];
    method: ImageUpscaleMethodId;
    scale: 2 | 4;
  }): Promise<ImageUpscaleBatchResponse> =>
    client.post('/media/image-upscale-batch', data, {
      timeout: 1200000,
    }),

  // 选中帧 → ZIP / 精灵图 / GIF / APNG
  exportVideoFrames: (data: {
    frame_urls: string[];
    output: VideoFrameExportOutput;
    rows?: number;
    cell_width?: number;
    cell_height?: number;
    gif_fps?: number;
    filename?: string;
    name_template?: string;
    progress_id?: string;
  }): Promise<VideoFrameExportResponse> =>
    client.post('/media/export-video-frames', data, {
      timeout: 300000,
    }),

  getVideoFrameExportProgress: (progressId: string): Promise<VideoFrameExportProgress> =>
    client.get(`/media/export-progress/${progressId}`),
  
  // 工作流
  getWorkflows: (): Promise<WorkflowsResponse> =>
    client.get('/service/workflows'),

  getWorkflowDefaults: (): Promise<WorkflowDefaultsResponse> =>
    client.get('/service/workflow/defaults'),

  switchWorkflow: (workflow_type: string): Promise<{ message: string }> =>
    client.post('/service/workflow/switch', null, { params: { workflow_type } }),
  // 预览
  getPreviews: (): Promise<{ previews: unknown[] }> =>
    client.get('/previews'),
  
  clearPreviews: (): Promise<{ message: string }> =>
    client.delete('/previews'),
};
