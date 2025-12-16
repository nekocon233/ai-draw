/**
 * 前端常量定义
 */

// ============ 本地存储键名 ============
export const STORAGE_KEYS = {
  ACCESS_TOKEN: 'access_token',
  USERNAME: 'username',
  GUEST_CONFIG: 'ai-draw-guest-config',
} as const;

// ============ API 端点 ============
export const API_ENDPOINTS = {
  // 认证
  AUTH_REGISTER: '/auth/register',
  AUTH_LOGIN: '/auth/login',
  
  // 用户配置
  USER_CONFIG: '/config/user',
  
  // 聊天历史
  CHAT_HISTORY: '/chat/history',
  CHAT_SAVE: '/chat/save',
  
  // 参考图
  REFERENCE_IMAGE: '/reference-image',
  
  // 服务状态
  SERVICE_STATUS: '/service/status',
  SERVICE_START: '/service/start',
  SERVICE_STOP: '/service/stop',
  SERVICE_WORKFLOWS: '/service/workflows',
  
  // Prompt 生成
  PROMPT_GENERATE: '/prompt/generate',
  
  // 图像生成
  IMAGE_GENERATE: '/image/generate',
  IMAGE_UPLOAD: '/image/upload-reference',
  IMAGE_STOP: '/image/stop',
} as const;

// ============ WebSocket ============
export const WS_CONFIG = {
  URL: 'ws://localhost:8000/ws',
  RECONNECT_DELAY: 2000,
  MAX_RECONNECT_ATTEMPTS: 10,
} as const;

// ============ 默认配置 ============
export const DEFAULT_CONFIG = {
  WORKFLOW: '参考',
  PROMPT: '1girl',
  LORA_PROMPT: '<lora:Ameniwa:0.6>',
  STRENGTH: 0.8,
  COUNT: 1,
  IMAGES_PER_ROW: 4,
} as const;

// ============ 工作流类型 ============
export const WORKFLOW_TYPES = [
  '参考',
  '上色',
  '图生图',
  '线稿',
] as const;

export type WorkflowType = typeof WORKFLOW_TYPES[number];

// ============ 消息类型 ============
export const MESSAGE_TYPES = {
  USER: 'user',
  ASSISTANT: 'assistant',
} as const;

// ============ WebSocket 消息类型 ============
export const WS_MESSAGE_TYPES = {
  STATE_CHANGE: 'state_change',
  ERROR: 'error',
} as const;

// ============ 状态字段 ============
export const STATE_FIELDS = {
  IS_GENERATING: 'is_generating',
  IMAGE_GENERATED: 'image_generated',
  PREVIEW_UPDATE: 'preview_update',
  GENERATION_PROGRESS: 'generation_progress',
} as const;

// ============ UI 配置 ============
export const UI_CONFIG = {
  STATUS_BAR_HEIGHT: 49, // StatusBar 高度（px）
  CHAT_HISTORY_LIMIT: 50, // 聊天历史最大条数
  IMAGE_MAX_SIZE: 10 * 1024 * 1024, // 图片最大尺寸 10MB
  DEBOUNCE_DELAY: 300, // 防抖延迟（ms）
} as const;

// ============ 表单验证 ============
export const VALIDATION = {
  USERNAME: {
    MIN_LENGTH: 3,
    MAX_LENGTH: 20,
    PATTERN: /^[a-zA-Z0-9_]+$/,
  },
  PASSWORD: {
    MIN_LENGTH: 6,
    MAX_LENGTH: 50,
  },
  EMAIL: {
    PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  },
  STRENGTH: {
    MIN: 0,
    MAX: 1,
    STEP: 0.1,
  },
  COUNT: {
    MIN: 1,
    MAX: 10,
  },
  IMAGES_PER_ROW: {
    MIN: 1,
    MAX: 8,
  },
} as const;
