/**
 * 前端常量定义
 */

// ============ 本地存储键名 ============
export const STORAGE_KEYS = {
  ACCESS_TOKEN: 'access_token',
  USERNAME: 'username',
  GUEST_CONFIG: 'ai-draw-guest-config',
  GUEST_CHAT_HISTORY: 'ai-draw-guest-chat',
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
  
  // 媒体生成
  MEDIA_GENERATE: '/media/generate',
  MEDIA_UPLOAD: '/media/upload-reference',
  MEDIA_STOP: '/media/stop',
} as const;

// ============ WebSocket ============
export const WS_CONFIG = {
  URL: 'ws://localhost:8000/ws',
  RECONNECT_DELAY: 2000,
  MAX_RECONNECT_ATTEMPTS: 10,
} as const;

// ============ 默认配置 ============
export const DEFAULT_CONFIG = {
  WORKFLOW: 't2i', // 后备默认工作流
  PROMPT: '1girl',
  LORA_PROMPT: '',  // 从后端 API 加载
  STRENGTH: 0.8,
  COUNT: 1,
  IMAGES_PER_ROW: 4,
} as const;

// ============ 工作流类型 ============
// 工作流类型现在从后端动态获取，不再硬编码
// 请使用 useAppStore 中的 availableWorkflows 获取可用工作流列表

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
  MEDIA_GENERATED: 'media_generated',
  PREVIEW_UPDATE: 'preview_update',
  GENERATION_PROGRESS: 'generation_progress',
  ERROR: 'error',
} as const;

// ============ UI 配置 ============
export const UI_CONFIG = {
  STATUS_BAR_HEIGHT: 49, // StatusBar 高度（px）
  CHAT_HISTORY_LIMIT: 50, // 聊天历史最大条数
  IMAGE_MAX_SIZE: 10 * 1024 * 1024, // 图片最大尺寸 10MB
  DEBOUNCE_DELAY: 300, // 防抖延迟（ms）
} as const;

// ============ 存储配置 ============
export const STORAGE_CONFIG = {
  MAX_HISTORY_MESSAGES: 100, // 游客模式最大历史消息数（约 50 轮对话）
  MIN_HISTORY_MESSAGES: 20,  // 配额不足时的最小保留消息数
  MAX_DATA_SIZE: 4 * 1024 * 1024, // 单个会话最大数据大小 (4MB)
  WARN_USAGE_PERCENTAGE: 80, // 存储使用率警告阈值 (80%)
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
