/**
 * 应用状态管理 (Zustand)
 */
import { create } from 'zustand';
import { apiService } from '../api/services';
import { 
  isLoggedIn, 
  loadGuestConfig,
  loadGuestSessions,
  saveGuestSessions,
  loadGuestSessionHistory,
  saveGuestSessionHistory,
  deleteGuestSession,
  loadGuestSessionConfig,
  saveGuestSessionConfig,
  deleteGuestSessionConfig
} from '../utils/helpers';
import { saveImages, deleteMessageImages } from '../utils/indexedDB';
import { DEFAULT_CONFIG } from '../utils/constants';
import type { ChatSession } from '../types/models';
import type { WorkflowMetadata } from '../types/api';

interface ChatMessage {
  id: string;
  session_id: string; // 关联会话ID
  type: 'user' | 'assistant';
  content: string; // 用户输入的提示词
  images?: (string | { loading: true })[]; // 生成的图片或加载状态
  timestamp: number;
  params?: {
    workflow: string;
    strength?: number;
    count?: number;
    loraPrompt?: string;       // LoRA 提示词
    promptEnd?: string;        // 结束帧提示词
    referenceImage?: string;   // 参考图 base64
    referenceImage2?: string;  // i2i 第 2 张参考图
    referenceImage3?: string;  // i2i 第 3 张参考图
    referenceImageEnd?: string; // 尾帧参考图 base64
    isLoop?: boolean;          // flf2v 是否循环
    frameRate?: number;        // flf2v 帧率
    startFrameCount?: number;  // flf2v 起始帧长度
    endFrameCount?: number;    // flf2v 结束帧长度
  }
}

interface AppState {
  // 聊天会话
  sessions: ChatSession[];
  currentSessionId: string | null;
  
  // 聊天历史
  chatHistory: ChatMessage[];
  // 服务状态
  isServiceAvailable: boolean;
  isGenerating: boolean;
  isGeneratingPrompt: boolean;
  currentGeneratingMessageId: string | null; // 当前正在生成的消息ID
  
  // 当前工作流
  currentWorkflow: string;
  availableWorkflows: WorkflowMetadata[]; // 可用工作流列表（动态从后端获取）
  
  // Prompt
  prompt: string;
  loraPrompt: string;
  promptEnd: string; // flf2v 结束帧提示词
  
  // 参数
  strength: number;
  count: number;
  imagesPerRow: number; // 每行显示图片数量
  width: number | null;  // 图像宽度（部分工作流支持）
  height: number | null; // 图像高度（部分工作流支持）
  useOriginalSize: boolean; // 是否使用原图尺寸（默认开启）
  isLoop: boolean;           // flf2v 循环生成
  startFrameCount: number | null; // flf2v 起始帧长度
  endFrameCount: number | null;   // flf2v 结束帧长度
  frameRate: number | null;       // flf2v 帧率
  
  // Gemini 多轮对话开关（nano_banana_pro 专用）
  nanoBananaSendHistory: boolean;
  
  // 参考图片
  referenceImage: string | null;
  referenceImage2: string | null; // i2i 第 2 张参考图
  referenceImage3: string | null; // i2i 第 3 张参考图
  referenceImageEnd: string | null; // flf2v 结束帧

  // 工作流图片暂存（切换工作流时保存各工作流的图片，切回时恢复）
  workflowImageStash: Record<string, {
    referenceImage: string | null;
    referenceImage2: string | null;
    referenceImage3: string | null;
    referenceImageEnd: string | null;
    promptEnd: string;
    prompt: string;       // 工作流独立 prompt
    loraPrompt: string;   // 工作流独立 LoRA prompt
  }>;
  
  // UI 状态
  loading: boolean;
  error: string | null;
  sidebarCollapsed: boolean;
  
  // Actions
  setServiceStatus: (status: { available: boolean; is_generating: boolean; is_generating_prompt: boolean }) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setCurrentWorkflow: (workflow: string) => void;
  setPrompt: (prompt: string) => void;
  setLoraPrompt: (prompt: string) => void;
  setPromptEnd: (prompt: string) => void;
  setStrength: (strength: number) => void;
  setCount: (count: number) => void;
  setImagesPerRow: (count: number) => void;
  setWidth: (width: number | null) => void;
  setHeight: (height: number | null) => void;
  setUseOriginalSize: (v: boolean) => void;
  setIsLoop: (v: boolean) => void;
  setStartFrameCount: (v: number | null) => void;
  setEndFrameCount: (v: number | null) => void;
  setFrameRate: (v: number | null) => void;
  setNanoBananaSendHistory: (v: boolean) => void;
  setReferenceImage: (image: string | null) => void;
  setReferenceImage2: (image: string | null) => void;
  setReferenceImage3: (image: string | null) => void;
  setReferenceImageEnd: (image: string | null) => void;
  addChatMessage: (params: { prompt: string; workflow: string; strength: number | undefined; count: number; loraPrompt?: string; promptEnd?: string; referenceImage?: string | null; referenceImage2?: string | null; referenceImage3?: string | null; referenceImageEnd?: string | null; isLoop?: boolean; frameRate?: number | null; startFrameCount?: number | null; endFrameCount?: number | null }) => Promise<string>;
  updateChatImages: (messageId: string, images: string[]) => void;
  appendChatMedia: (messageId: string, image: string, index: number) => void;
  deleteChatMessage: (messageId: string) => Promise<void>;
  editAndRegenerateMessage: (
    userMsgId: string,
    newContent: string,
    newRefImages: { referenceImage?: string | null; referenceImage2?: string | null; referenceImage3?: string | null },
    newPromptEnd?: string
  ) => Promise<void>;
  clearChatHistory: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  reset: () => void;
  stopGeneration: () => void;
  loadDefaultConfig: () => Promise<void>;
  loadAvailableWorkflows: () => Promise<void>;
  loadUserConfig: () => Promise<void>;
  saveUserConfig: () => Promise<void>;
  saveChatMessage: (message: ChatMessage) => Promise<void>;
  
  // 会话管理 Actions
  loadSessions: () => Promise<void>;
  createSession: (title?: string) => Promise<string>;
  deleteSession: (sessionId: string) => Promise<void>;
  switchSession: (sessionId: string) => Promise<void>;
  updateSessionTitle: (sessionId: string, title: string) => Promise<void>;
  
  // 会话配置管理
  saveSessionConfig: () => void;
  loadSessionConfig: (sessionId: string) => Promise<void>;
}

// 加载游客配置或使用默认值
const guestConfig = loadGuestConfig();
const defaultConfig = {
  currentWorkflow: DEFAULT_CONFIG.WORKFLOW,
  prompt: DEFAULT_CONFIG.PROMPT,
  loraPrompt: DEFAULT_CONFIG.LORA_PROMPT,
  strength: DEFAULT_CONFIG.STRENGTH,
  count: DEFAULT_CONFIG.COUNT,
  imagesPerRow: DEFAULT_CONFIG.IMAGES_PER_ROW,
  referenceImage: null,
};
// 确保 currentWorkflow 始终有有效值
const initialConfig = guestConfig ? {
  ...defaultConfig,
  ...guestConfig,
  currentWorkflow: guestConfig.currentWorkflow || defaultConfig.currentWorkflow,
} : defaultConfig;

export const useAppStore = create<AppState>((set, get) => ({
  // 初始状态
  sessions: [],
  currentSessionId: null,
  isServiceAvailable: false,
  isGenerating: false,
  isGeneratingPrompt: false,
  currentGeneratingMessageId: null,
  currentWorkflow: initialConfig.currentWorkflow,
  availableWorkflows: [], // 初始为空，从后端动态获取
  prompt: initialConfig.prompt,
  loraPrompt: initialConfig.loraPrompt,
  promptEnd: '',
  strength: initialConfig.strength,
  count: initialConfig.count,
  imagesPerRow: initialConfig.imagesPerRow,
  width: null,  // 图像宽度，默认为 null 表示使用工作流默认值
  height: null, // 图像高度，默认为 null 表示使用工作流默认值
  useOriginalSize: true,  // 默认使用原图尺寸
  isLoop: false,
  startFrameCount: null,
  endFrameCount: null,
  frameRate: null,
  nanoBananaSendHistory: localStorage.getItem('nanoBananaSendHistory') === 'true',
  referenceImage: initialConfig.referenceImage,
  referenceImage2: null,
  referenceImage3: null,
  referenceImageEnd: null,
  workflowImageStash: {},
  chatHistory: [],
  loading: false,
  error: null,
  sidebarCollapsed: localStorage.getItem('sidebarCollapsed') === 'true' || (!isLoggedIn() && localStorage.getItem('sidebarCollapsed') === null),
  
  // Actions
  setServiceStatus: (status) => set({
    isServiceAvailable: status.available,
    isGenerating: status.is_generating,
    isGeneratingPrompt: status.is_generating_prompt,
  }),
  
  setCurrentWorkflow: async (workflow) => {
    const state = get();
    const workflowMeta = state.availableWorkflows.find(w => w.key === workflow);
    
    // 切换工作流时，根据工作流参数配置重置参数为默认值或置空
    if (workflowMeta) {
      const updates: Partial<AppState> = { currentWorkflow: workflow };
      
      // 检查工作流是否有对应的参数，如果没有则置空
      const hasStrength = workflowMeta.parameters.some(p => p.name === 'strength');
      const hasCount = workflowMeta.parameters.some(p => p.name === 'count');
      const hasLoraPrompt = workflowMeta.parameters.some(p => p.name === 'lora_prompt');
      const hasWidth = workflowMeta.parameters.some(p => p.name === 'width');
      const hasHeight = workflowMeta.parameters.some(p => p.name === 'height');
      const hasStartFrameCount = workflowMeta.parameters.some(p => p.name === 'startFrameCount');
      const hasEndFrameCount = workflowMeta.parameters.some(p => p.name === 'endFrameCount');
      const hasFrameRate = workflowMeta.parameters.some(p => p.name === 'frameRate');
      
      workflowMeta.parameters.forEach(param => {
        if (param.name === 'prompt') {
          updates.prompt = param.default as string;
        } else if (param.name === 'strength') {
          updates.strength = param.default as number;
        } else if (param.name === 'count') {
          updates.count = param.default as number;
        } else if (param.name === 'lora_prompt') {
          updates.loraPrompt = param.default as string;
        } else if (param.name === 'width') {
          updates.width = param.default as number;
        } else if (param.name === 'height') {
          updates.height = param.default as number;
        } else if (param.name === 'startFrameCount') {
          updates.startFrameCount = param.default as number;
        } else if (param.name === 'endFrameCount') {
          updates.endFrameCount = param.default as number;
        } else if (param.name === 'frameRate') {
          updates.frameRate = param.default as number;
        }
      });
      
      // 如果工作流没有对应参数，置空或设为默认值
      if (!hasLoraPrompt) {
        updates.loraPrompt = '';
      }
      if (!hasStrength) {
        updates.strength = DEFAULT_CONFIG.STRENGTH;
      }
      if (!hasCount) {
        updates.count = DEFAULT_CONFIG.COUNT;
      }
      if (!hasWidth) {
        updates.width = null;
      }
      if (!hasHeight) {
        updates.height = null;
      }
      if (!hasStartFrameCount) {
        updates.startFrameCount = null;
      }
      if (!hasEndFrameCount) {
        updates.endFrameCount = null;
      }
      if (!hasFrameRate) {
        updates.frameRate = null;
      }
      // 切换工作流时重置 isLoop
      (updates as any).isLoop = false;
      (updates as any).useOriginalSize = true;

      // 将当前工作流的图片暂存，恢复目标工作流之前保存的图片
      const currentWorkflow = state.currentWorkflow;
      const stash = { ...state.workflowImageStash };
      stash[currentWorkflow] = {
        referenceImage: state.referenceImage,
        referenceImage2: state.referenceImage2,
        referenceImage3: state.referenceImage3,
        referenceImageEnd: state.referenceImageEnd,
        promptEnd: state.promptEnd,
        prompt: state.prompt,
        loraPrompt: state.loraPrompt,
      };
      const saved = stash[workflow];
      (updates as any).referenceImage = saved?.referenceImage ?? null;
      (updates as any).referenceImage2 = saved?.referenceImage2 ?? null;
      (updates as any).referenceImage3 = saved?.referenceImage3 ?? null;
      (updates as any).referenceImageEnd = saved?.referenceImageEnd ?? null;
      (updates as any).promptEnd = saved?.promptEnd ?? '';
      // 恢复工作流独立 prompt/loraPrompt，无暂存时才使用 yaml 默认值
      if (saved?.prompt !== undefined) {
        (updates as any).prompt = saved.prompt;
      }
      if (saved?.loraPrompt !== undefined) {
        (updates as any).loraPrompt = saved.loraPrompt;
      }
      (updates as any).workflowImageStash = stash;

      set(updates);
    } else {
      set({ currentWorkflow: workflow });
    }
    
    state.saveSessionConfig();
  },
  setPrompt: async (prompt) => {
    set({ prompt });
    const state = get();
    state.saveSessionConfig();
  },
  setLoraPrompt: async (prompt) => {
    set({ loraPrompt: prompt });
    const state = get();
    state.saveSessionConfig();
  },
  setPromptEnd: async (prompt) => {
    set({ promptEnd: prompt });
    const state = get();
    state.saveSessionConfig();
  },
  setStrength: async (strength) => {
    set({ strength });
    const state = get();
    state.saveSessionConfig();
  },
  setCount: async (count) => {
    set({ count });
    const state = get();
    state.saveSessionConfig();
  },
  setImagesPerRow: async (count) => {
    set({ imagesPerRow: count });
    const state = get();
    state.saveSessionConfig();
  },
  setWidth: async (width) => {
    set({ width });
    const state = get();
    state.saveSessionConfig();
  },
  setHeight: async (height) => {
    set({ height });
    const state = get();
    state.saveSessionConfig();
  },
  setReferenceImage: async (image) => {
    set({ referenceImage: image });
    const state = get();
    state.saveSessionConfig();
  },
  setReferenceImage2: async (image) => {
    set({ referenceImage2: image });
    const state = get();
    state.saveSessionConfig();
  },
  setReferenceImage3: async (image) => {
    set({ referenceImage3: image });
    const state = get();
    state.saveSessionConfig();
  },
  setReferenceImageEnd: async (image) => {
    set({ referenceImageEnd: image });
    const state = get();
    state.saveSessionConfig();
  },
  setUseOriginalSize: (v) => {
    set({ useOriginalSize: v });
  },
  setIsLoop: (v) => {
    set({ isLoop: v });
    const state = get();
    state.saveSessionConfig();
  },
  setStartFrameCount: (v) => {
    set({ startFrameCount: v });
    const state = get();
    state.saveSessionConfig();
  },
  setEndFrameCount: (v) => {
    set({ endFrameCount: v });
    const state = get();
    state.saveSessionConfig();
  },
  setFrameRate: (v) => {
    set({ frameRate: v });
    const state = get();
    state.saveSessionConfig();
  },
  setNanoBananaSendHistory: (v) => {
    set({ nanoBananaSendHistory: v });
    localStorage.setItem('nanoBananaSendHistory', String(v));
  },
  addChatMessage: async ({ prompt, workflow, strength, count, loraPrompt, promptEnd, referenceImage, referenceImage2, referenceImage3, referenceImageEnd, isLoop, frameRate, startFrameCount, endFrameCount }) => {
    const state = get();
    // 如果没有当前会话，自动创建一个
    let sessionId = state.currentSessionId;
    if (!sessionId) {
      // 登录用户：调用API创建真实会话
      if (isLoggedIn()) {
        try {
          const response = await apiService.createSession('新对话');
          sessionId = response.session_id;
          const newSession: ChatSession = {
            id: sessionId,
            title: response.title,
            created_at: response.created_at,
            updated_at: response.updated_at,
            message_count: 0,
          };
          set({ 
            sessions: [newSession, ...state.sessions], // 新会话放在最前面
            currentSessionId: sessionId 
          });
        } catch (err) {
          console.error('创建会话失败:', err);
          set({ error: '创建会话失败，请重试' });
          return '';
        }
      } else {
        // 游客模式：创建本地会话
        const newSessionId = `session-${Date.now()}`;
        const newSession: ChatSession = {
          id: newSessionId,
          title: '新对话',
          created_at: Date.now(),
          updated_at: Date.now(),
          message_count: 0,
        };
        set({ 
          sessions: [newSession, ...state.sessions], // 新会话放在最前面
          currentSessionId: newSessionId 
        });
        sessionId = newSessionId;
      }
    }
    
    // 确保 sessionId 不为 null
    if (!sessionId) {
      console.error('无法创建消息：会话ID为空');
      set({ error: '会话创建失败，请重试' });
      return '';
    }
    
    const messageId = `msg-${Date.now()}`;
    const userMessage: ChatMessage = {
      id: messageId,
      session_id: sessionId,
      type: 'user',
      content: prompt,
      timestamp: Date.now(),
      params: {
        workflow, strength, count, loraPrompt,
        promptEnd: promptEnd || undefined,
        referenceImage: referenceImage || undefined,
        referenceImage2: referenceImage2 || undefined,
        referenceImage3: referenceImage3 || undefined,
        referenceImageEnd: referenceImageEnd || undefined,
        isLoop: isLoop ?? undefined,
        frameRate: frameRate ?? undefined,
        startFrameCount: startFrameCount ?? undefined,
        endFrameCount: endFrameCount ?? undefined,
      }
    };
    const assistantMessage: ChatMessage = {
      id: `${messageId}-reply`,
      session_id: sessionId,
      type: 'assistant',
      content: '',
      images: [{ loading: true as const }],
      timestamp: Date.now(),
      params: { workflow, strength, count, loraPrompt, isLoop, frameRate: frameRate ?? undefined, startFrameCount: startFrameCount ?? undefined, endFrameCount: endFrameCount ?? undefined } // 存储总数用于判断
    };
    set((state) => {
      const newHistory = [...state.chatHistory, userMessage, assistantMessage];
      // 更新会话的消息数量和更新时间
      const updatedSessions = state.sessions.map(s => 
        s.id === sessionId 
          ? { ...s, message_count: s.message_count + 2, updated_at: Date.now() }
          : s
      );
      
      // 游客模式：保存到 localStorage（按会话分离）
      if (!isLoggedIn()) {
        saveGuestSessionHistory(sessionId, newHistory);
        saveGuestSessions(updatedSessions);
      }
      return { 
        chatHistory: newHistory,
        sessions: updatedSessions,
        currentGeneratingMessageId: `${messageId}-reply` // 设置当前生成任务ID
      };
    });
    
    // 登录用户：异步保存用户消息
    if (isLoggedIn()) {
      apiService.saveChatMessage({
        session_id: sessionId,
        message_id: messageId,
        type: 'user',
        content: prompt,
        workflow,
        strength,
        count,
        lora_prompt: loraPrompt,
        reference_image: referenceImage || undefined,
        reference_image_2: referenceImage2 || undefined,
        reference_image_3: referenceImage3 || undefined,
        reference_image_end: referenceImageEnd || undefined,
        prompt_end: promptEnd || undefined,
        frame_rate: frameRate ?? undefined,
        start_frame_count: startFrameCount ?? undefined,
        end_frame_count: endFrameCount ?? undefined,
      }).catch(err => console.error('保存用户消息失败:', err));
    }
    
    return `${messageId}-reply`;
  },
  updateChatImages: (messageId, images) => {
    set((state) => {
      const newHistory = state.chatHistory.map((msg) =>
        msg.id === messageId
          ? { ...msg, images }
          : msg
      );
      // 游客模式：保存到 IndexedDB 和 localStorage
      if (!isLoggedIn() && state.currentSessionId) {
        const message = newHistory.find(m => m.id === messageId);
        if (message && message.session_id) {
          // 保存图片到 IndexedDB（跳过视频，游客模式仅临时展示）
          const validMediaItems = images.filter(img => typeof img === 'string' && !img.startsWith('data:video/') && !img.includes('/video/')) as string[];
          if (validMediaItems.length > 0) {
            saveImages(message.session_id, messageId, validMediaItems)
              .catch(err => console.error('保存图片到 IndexedDB 失败:', err));
          }
        }
        // 保存消息元数据到 localStorage（图片用占位符）
        saveGuestSessionHistory(state.currentSessionId, newHistory);
      }
      return { chatHistory: newHistory };
    });
    
    // 登录用户：异步保存 AI 消息
    if (isLoggedIn()) {
      const state = useAppStore.getState();
      const message = state.chatHistory.find(msg => msg.id === messageId);
      if (message && message.type === 'assistant') {
        apiService.saveChatMessage({
          session_id: message.session_id,
          message_id: messageId,
          type: 'assistant',
          content: '',
          images: images.filter(img => typeof img === 'string') as string[],
        }).catch(err => console.error('保存 AI 消息失败:', err));
      }
    }
  },
  appendChatMedia: (messageId: string, image: string, index: number) => {
    set((state) => {
      const newHistory = state.chatHistory.map((msg) => {
        if (msg.id === messageId && msg.images) {
          const newImages = [...msg.images];
          
          // 确保数组长度足够（扩展到 index+1），不依赖 params.count（flf2v 等工作流可能为 null）
          while (newImages.length <= index) {
            newImages.push({ loading: true as const });
          }
          
          // 直接按 index 替换
          if (index >= 0) {
            newImages[index] = image;
          }
          
          return { ...msg, images: newImages };
        }
        return msg;
      });
      
      // 游客模式：保存到 IndexedDB
      if (!isLoggedIn()) {
        const state = useAppStore.getState();
        if (state.currentSessionId) {
          const message = newHistory.find(m => m.id === messageId);
          if (message && message.session_id) {
            // 保存单张图片到 IndexedDB（跳过视频，游客模式仅临时展示）
            import('../utils/indexedDB').then(({ saveImage }) => {
              if (!image.startsWith('data:video/') && !image.includes('/video/')) {
                saveImage(message.session_id, messageId, image, index)
                  .catch(err => console.error('保存图片到 IndexedDB 失败:', err));
              }
            });
          }
          // 保存消息元数据到 localStorage
          saveGuestSessionHistory(state.currentSessionId, newHistory);
        }
      }
      
      return { chatHistory: newHistory };
    });
  },
  deleteChatMessage: async (messageId: string) => {
    const state = get();
    const sessionId = state.currentSessionId;
    if (!sessionId) return;

    // 找到用户消息索引，以及紧跟其后的 AI 回复
    const msgIndex = state.chatHistory.findIndex(m => m.id === messageId && m.type === 'user');
    if (msgIndex === -1) return;

    const nextMsg = state.chatHistory[msgIndex + 1];
    const idsToRemove = new Set<string>([messageId]);
    if (nextMsg && nextMsg.type === 'assistant') {
      idsToRemove.add(nextMsg.id);
    }

    if (isLoggedIn()) {
      try {
        await apiService.deleteMessage(sessionId, messageId);
      } catch (error) {
        console.error('删除消息失败:', error);
        throw error;
      }
    } else {
      // 游客模式：从 IndexedDB 删除图片
      deleteMessageImages(sessionId, messageId).catch(() => {});
      if (nextMsg && nextMsg.type === 'assistant') {
        deleteMessageImages(sessionId, nextMsg.id).catch(() => {});
      }
    }

    set((state) => {
      const newHistory = state.chatHistory.filter(m => !idsToRemove.has(m.id));
      const updatedSessions = state.sessions.map(s =>
        s.id === sessionId
          ? { ...s, message_count: Math.max(0, s.message_count - idsToRemove.size), updated_at: Date.now() }
          : s
      );
      if (!isLoggedIn()) {
        saveGuestSessionHistory(sessionId, newHistory);
        saveGuestSessions(updatedSessions);
      }
      return { chatHistory: newHistory, sessions: updatedSessions };
    });
  },
  editAndRegenerateMessage: async (userMsgId, newContent, newRefImages, newPromptEnd) => {
    const state = get();
    const sessionId = state.currentSessionId;
    if (!sessionId) return;

    const msgIndex = state.chatHistory.findIndex(m => m.id === userMsgId && m.type === 'user');
    if (msgIndex === -1) return;

    const userMsg = state.chatHistory[msgIndex];
    const nextMsg = state.chatHistory[msgIndex + 1];
    if (!nextMsg || nextMsg.type !== 'assistant') return;
    const assistantMsgId = nextMsg.id;

    const count = userMsg.params?.count || 1;
    const loadingImages = Array.from({ length: count }, () => ({ loading: true as const }));

    // 更新 state：修改用户消息内容 + 重置 AI 回复为 loading 状态
    set((s) => ({
      chatHistory: s.chatHistory.map((msg) => {
        if (msg.id === userMsgId) {
          return {
            ...msg,
            content: newContent,
            params: {
              ...msg.params!,
              referenceImage: newRefImages.referenceImage !== undefined
                ? (newRefImages.referenceImage || undefined)
                : msg.params?.referenceImage,
              referenceImage2: newRefImages.referenceImage2 !== undefined
                ? (newRefImages.referenceImage2 || undefined)
                : msg.params?.referenceImage2,
              referenceImage3: newRefImages.referenceImage3 !== undefined
                ? (newRefImages.referenceImage3 || undefined)
                : msg.params?.referenceImage3,
              promptEnd: newPromptEnd !== undefined ? (newPromptEnd || undefined) : msg.params?.promptEnd,
            },
          };
        }
        if (msg.id === assistantMsgId) {
          return { ...msg, images: loadingImages };
        }
        return msg;
      }),
      currentGeneratingMessageId: assistantMsgId,
    }));

    // 登录用户：先等待数据库更新完成，再触发生成（避免与 generateMedia 的竞态条件）
    if (isLoggedIn()) {
      try {
        await apiService.updateMessageContent(userMsgId, {
          content: newContent,
          reference_image: newRefImages.referenceImage !== undefined ? newRefImages.referenceImage : undefined,
          reference_image_2: newRefImages.referenceImage2 !== undefined ? newRefImages.referenceImage2 : undefined,
          reference_image_3: newRefImages.referenceImage3 !== undefined ? newRefImages.referenceImage3 : undefined,
        });
      } catch (err) {
        console.error('更新消息内容失败:', err);
      }
    } else {
      // 游客模式：更新 localStorage
      const updated = get();
      saveGuestSessionHistory(sessionId, updated.chatHistory);
    }

    // 触发重新生成
    const params = userMsg.params!;
    // nano_banana_pro 时读取当前 nanoBananaSendHistory 状态，与 ChatInput.tsx 保持一致
    const isNanoBananaPro = params.workflow === 'nano_banana_pro';
    const sendHistory = isNanoBananaPro ? get().nanoBananaSendHistory : false;
    const finalImg1 = newRefImages.referenceImage !== undefined ? newRefImages.referenceImage : params.referenceImage;
    const finalImg2 = newRefImages.referenceImage2 !== undefined ? newRefImages.referenceImage2 : params.referenceImage2;
    const finalImg3 = newRefImages.referenceImage3 !== undefined ? newRefImages.referenceImage3 : params.referenceImage3;
    const finalPromptEnd = newPromptEnd !== undefined ? newPromptEnd : params.promptEnd;

    try {
      await apiService.generateMedia({
        prompt: newContent,
        workflow: params.workflow,
        strength: params.strength ?? undefined,
        lora_prompt: params.loraPrompt,
        count: count,
        reference_image: finalImg1 || undefined,
        reference_image_2: finalImg2 || undefined,
        reference_image_3: finalImg3 || undefined,
        reference_image_end: params.referenceImageEnd || undefined,
        prompt_end: finalPromptEnd || undefined,
        is_loop: params.isLoop,
        frame_rate: params.frameRate ?? undefined,
        start_frame_count: params.startFrameCount ?? undefined,
        end_frame_count: params.endFrameCount ?? undefined,
        use_original_size: true,
        // 仅 nano_banana_pro + sendHistory=true 时传 session_id，与 ChatInput.tsx 逻辑一致
        send_history: isNanoBananaPro ? sendHistory : undefined,
        session_id: isNanoBananaPro && sendHistory ? sessionId : undefined,
      });
    } catch (err) {
      console.error('重新生成失败:', err);
      // 生成失败时清除 loading 状态
      set((s) => ({
        chatHistory: s.chatHistory.map((msg) =>
          msg.id === assistantMsgId ? { ...msg, images: [] } : msg
        ),
        currentGeneratingMessageId: null,
      }));
    }
  },
  clearChatHistory: () => set({ chatHistory: [] }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
  setSidebarCollapsed: (collapsed) => {
    set({ sidebarCollapsed: collapsed });
    localStorage.setItem('sidebarCollapsed', String(collapsed));
  },
  stopGeneration: () => {
    // TODO: 实现停止生成的逻辑
    set({ loading: false, isGenerating: false });
  },
  reset: () => set({
    prompt: '',
    loraPrompt: '',
    strength: 0.5,
    count: 1,
    referenceImage: null,
    referenceImage2: null,
    referenceImage3: null,
    referenceImageEnd: null,
    chatHistory: [],
    loading: false,
    error: null,
  }),
  
  // 加载用户配置
  loadUserConfig: async () => {
    try {
      const config = await apiService.getUserConfig();
      set({
        currentWorkflow: config.current_workflow,
        prompt: config.prompt,
        loraPrompt: config.lora_prompt,
        strength: config.strength,
        count: config.count,
        imagesPerRow: config.images_per_row,
      });
      
      // 加载参考图
      const refImg = await apiService.getReferenceImage();
      if (refImg.image) {
        set({ referenceImage: refImg.image });
      }
    } catch (error) {
      console.error('加载用户配置失败:', error);
    }
  },
  
  // 手动保存配置（批量更新）
  saveUserConfig: async () => {
    const state = useAppStore.getState();
    try {
      await apiService.updateUserConfig({
        current_workflow: state.currentWorkflow,
        prompt: state.prompt,
        lora_prompt: state.loraPrompt,
        strength: state.strength,
        count: state.count,
        images_per_row: state.imagesPerRow,
      });
    } catch (error) {
      console.error('保存用户配置失败:', error);
      throw error;
    }
  },
  
  // 加载默认配置（从后端 API 获取）
  loadDefaultConfig: async () => {
    try {
      const response = await apiService.getWorkflowDefaults();
      if (response.success && response.defaults) {
        const defaults = response.defaults;
        // 从 workflow_metadata 中获取 t2i 的 parameters 数组，转成 {name: default} 映射
        const t2iParams: { name: string; default?: unknown }[] =
          defaults.workflow_metadata?.t2i?.parameters || [];
        const getParamDefault = (name: string) =>
          t2iParams.find((p) => p.name === name)?.default;

        // 游客模式下：如果当前 loraPrompt 为空，则更新为后端默认值
        if (!isLoggedIn()) {
          const currentState = get();
          if (!currentState.loraPrompt) {
            set({
              loraPrompt: (getParamDefault('lora_prompt') as string) || '',
              prompt: currentState.prompt || (getParamDefault('prompt') as string) || DEFAULT_CONFIG.PROMPT,
              strength: currentState.strength ?? (getParamDefault('strength') as number) ?? DEFAULT_CONFIG.STRENGTH,
              count: currentState.count ?? (getParamDefault('count') as number) ?? DEFAULT_CONFIG.COUNT,
            });
          }
        }
      }
    } catch (error) {
      console.error('加载默认配置失败:', error);
      // 加载失败时不做任何修改，保持当前状态
    }
  },

  // 加载可用工作流列表
  loadAvailableWorkflows: async () => {
    try {
      const response = await apiService.getWorkflows();
      const workflows = response.workflows || [];
      const defaultWorkflow = response.default_workflow;
      
      set({ availableWorkflows: workflows });
      
      // 如果当前工作流不在可用列表中，设置为后端配置的默认工作流
      const state = useAppStore.getState();
      const workflowKeys = workflows.map(w => w.key);
      if (workflows.length > 0 && !workflowKeys.includes(state.currentWorkflow)) {
        state.setCurrentWorkflow(defaultWorkflow || workflows[0].key);
      }
    } catch (error) {
      console.error('加载工作流列表失败:', error);
    }
  },
  
  // 保存单条消息
  saveChatMessage: async (message: ChatMessage) => {
    try {
      await apiService.saveChatMessage({
        session_id: message.session_id,
        message_id: message.id,
        type: message.type,
        content: message.content,
        workflow: message.params?.workflow,
        strength: message.params?.strength,
        count: message.params?.count,
        lora_prompt: message.params?.loraPrompt,
        images: message.images?.filter(img => typeof img === 'string') as string[],
      });
    } catch (error) {
      console.error('保存消息失败:', error);
      throw error;
    }
  },
  
  // ============ 会话管理 ============
  
  // 加载会话列表
  loadSessions: async () => {
    if (!isLoggedIn()) {
      // 游客模式：从 localStorage 加载
      let sessions = loadGuestSessions();
      
     
      
      // 如果有会话，恢复上次选中的会话
      if (sessions.length > 0) {
        const savedSessionId = localStorage.getItem('currentSessionId');
        const currentSessionId = (savedSessionId && sessions.some(s => s.id === savedSessionId)) 
          ? savedSessionId 
          : sessions[0].id;
        
        // 加载会话历史（带占位符）
        const chatHistoryWithoutImages = loadGuestSessionHistory(currentSessionId);
        
        set({ 
          sessions,
          currentSessionId,
          chatHistory: chatHistoryWithoutImages
        });
        
        // 异步恢复图片数据
        import('../utils/helpers').then(async ({ restoreSessionImages }) => {
          try {
            const chatHistory = await restoreSessionImages(currentSessionId, chatHistoryWithoutImages);
            set({ chatHistory });
          } catch (error) {
            console.error('恢复图片数据失败:', error);
          }
        });
        
        // 加载当前会话的配置
        await get().loadSessionConfig(currentSessionId);
      } else {
        // 没有会话时，仅设置空会话列表，不预创建
        set({ 
          sessions: [],
          currentSessionId: null,
          chatHistory: []
        });
      }
      return;
    }
    
    try {
      const sessions = await apiService.getSessions();
      set({ sessions });
      
      const state = get();
      // 尝试恢复上次的 currentSessionId
      let restoredSessionId: string | null = null;
      try {
        const userConfig = await apiService.getUserConfig();
        restoredSessionId = (userConfig as any).current_session_id || null;
      } catch (error) {
        console.error('获取用户配置失败:', error);
      }
      
      // 验证恢复的 sessionId 是否存在
      if (restoredSessionId && sessions.some(s => s.id === restoredSessionId)) {
        await state.switchSession(restoredSessionId);
      } else if (sessions.length > 0) {
        // 否则选择最新的会话
        const latestSession = sessions.sort((a, b) => b.updated_at - a.updated_at)[0];
        await state.switchSession(latestSession.id);
      }
    } catch (error) {
      console.error('加载会话列表失败:', error);
    }
  },
  
  // 创建新会话
  createSession: async (title?: string) => {
    const state = get();
    const newTitle = title || `对话 ${new Date().toLocaleString('zh-CN')}`;
    const sessionId = `session-${Date.now()}`;
    
    // 保存当前会话的配置（如果存在）
    if (state.currentSessionId) {
      state.saveSessionConfig();
    }
    
    // 确保工作流列表已加载
    if (state.availableWorkflows.length === 0) {
      await state.loadAvailableWorkflows();
    }
    
    // 从 availableWorkflows 获取默认工作流（文生图）的默认参数
    const defaultWorkflow = state.availableWorkflows.find(w => w.key === DEFAULT_CONFIG.WORKFLOW);
    let defaultPrompt: string = DEFAULT_CONFIG.PROMPT;
    let defaultLoraPrompt: string = DEFAULT_CONFIG.LORA_PROMPT;
    let defaultStrength: number = DEFAULT_CONFIG.STRENGTH;
    let defaultCount: number = DEFAULT_CONFIG.COUNT;
    
    if (defaultWorkflow) {
      const promptParam = defaultWorkflow.parameters.find(p => p.name === 'prompt');
      const loraParam = defaultWorkflow.parameters.find(p => p.name === 'lora_prompt');
      const strengthParam = defaultWorkflow.parameters.find(p => p.name === 'strength');
      const countParam = defaultWorkflow.parameters.find(p => p.name === 'count');
      
      if (promptParam && promptParam.default !== undefined) defaultPrompt = promptParam.default as string;
      if (loraParam && loraParam.default !== undefined) defaultLoraPrompt = loraParam.default as string;
      if (strengthParam && strengthParam.default !== undefined) defaultStrength = strengthParam.default as number;
      if (countParam && countParam.default !== undefined) defaultCount = countParam.default as number;
    }
    
    const newSession: ChatSession = {
      id: sessionId,
      title: newTitle,
      created_at: Date.now(),
      updated_at: Date.now(),
      message_count: 0,
    };
    
    // 更新本地状态
    set((state) => ({
      sessions: [newSession, ...state.sessions],
      currentSessionId: sessionId,
      chatHistory: [], // 清空当前聊天历史
    }));
    
    // 为新会话初始化配置（使用默认工作流的默认参数）
    const newSessionConfig = {
      workflow: DEFAULT_CONFIG.WORKFLOW,
      prompt: defaultPrompt,
      loraPrompt: defaultLoraPrompt,
      strength: defaultStrength,
      count: defaultCount,
      imagesPerRow: DEFAULT_CONFIG.IMAGES_PER_ROW,
      referenceImage: null,
    };
    
    if (isLoggedIn()) {
      // 登录用户：保存到后端
      try {
        // 后端会生成自己的 session_id，这里只传 title
        const response = await apiService.createSession(newTitle);
        const realSessionId = response.session_id;
        
        // 更新为后端返回的真实 session_id（后端已经返回毫秒级时间戳，无需再乘以1000）
        set((state) => ({
          sessions: state.sessions.map(s => 
            s.id === sessionId 
              ? { ...s, id: realSessionId, created_at: response.created_at, updated_at: response.updated_at }
              : s
          ),
          currentSessionId: realSessionId
        }));
        
        // 持久化当前会话ID到后端
        await apiService.updateUserConfig({ current_session_id: realSessionId })
          .catch(err => console.error('保存当前会话ID失败:', err));
        
        // 保存新会话的配置到后端
        await apiService.updateSessionConfig(realSessionId, {
          workflow: newSessionConfig.workflow,
          prompt: newSessionConfig.prompt,
          lora_prompt: newSessionConfig.loraPrompt,
          strength: newSessionConfig.strength,
          count: newSessionConfig.count,
          images_per_row: newSessionConfig.imagesPerRow,
          reference_image: newSessionConfig.referenceImage,
        }).catch(err => console.error('初始化会话配置失败:', err));
        
        // 立即应用后端默认配置
        set({
          currentWorkflow: newSessionConfig.workflow,
          prompt: newSessionConfig.prompt,
          loraPrompt: newSessionConfig.loraPrompt,
          strength: newSessionConfig.strength,
          count: newSessionConfig.count,
          imagesPerRow: newSessionConfig.imagesPerRow,
          referenceImage: null,
          referenceImage2: null,
          referenceImage3: null,
          referenceImageEnd: null,
          promptEnd: '',
          workflowImageStash: {},
        });
        
        return realSessionId;
      } catch (error) {
        console.error('创建会话失败:', error);
        return sessionId;
      }
    } else {
      // 游客模式：保存到 localStorage
      saveGuestSessions(get().sessions);
      saveGuestSessionHistory(sessionId, []);
      saveGuestSessionConfig(sessionId, newSessionConfig);
      localStorage.setItem('currentSessionId', sessionId);
      
      // 立即应用后端默认配置
      set({
        currentWorkflow: newSessionConfig.workflow,
        prompt: newSessionConfig.prompt,
        loraPrompt: newSessionConfig.loraPrompt,
        strength: newSessionConfig.strength,
        count: newSessionConfig.count,
        imagesPerRow: newSessionConfig.imagesPerRow,
        referenceImage: null,
        referenceImage2: null,
        referenceImage3: null,
        referenceImageEnd: null,
        promptEnd: '',
        workflowImageStash: {},
      });
      
      return sessionId;
    }
  },
  
  // 删除会话
  deleteSession: async (sessionId: string) => {
    const state = get();
    
    // 如果删除的是当前会话，切换到其他会话
    if (state.currentSessionId === sessionId) {
      const otherSessions = state.sessions.filter(s => s.id !== sessionId);
      if (otherSessions.length > 0) {
        await state.switchSession(otherSessions[0].id);
      } else {
        set({ currentSessionId: null, chatHistory: [] });
      }
    }
    
    // 删除会话
    set((state) => ({
      sessions: state.sessions.filter(s => s.id !== sessionId),
    }));
    
    if (isLoggedIn()) {
      // 登录用户：从后端删除会话
      try {
        await apiService.deleteSession(sessionId);
      } catch (error) {
        console.error('删除会话失败:', error);
      }
    } else {
      // 游客模式：从 localStorage 删除会话数据和配置
      deleteGuestSession(sessionId);
      deleteGuestSessionConfig(sessionId);
    }
  },
  
  // 切换会话
  switchSession: async (sessionId: string) => {
    const state = get();
    
    // 如果有正在生成的任务，先停止
    if (state.isGenerating) {
      console.warn('切换会话时自动停止图片生成');
      state.stopGeneration();
    }
    
    set({ currentSessionId: sessionId });
    
    // 持久化 currentSessionId（登录用户保存到后端配置，游客保存到 localStorage）
    if (isLoggedIn()) {
      try {
        await apiService.updateUserConfig({ current_session_id: sessionId });
      } catch (error) {
        console.error('保存当前会话ID失败:', error);
      }
    } else {
      localStorage.setItem('currentSessionId', sessionId);
    }
    
    // 加载该会话的配置
    await state.loadSessionConfig(sessionId);
    
    // 加载该会话的聊天历史
    if (isLoggedIn()) {
      try {
        const response: any = await apiService.getChatHistory(50, sessionId);
        const messages = response.messages || [];
        
        // 转换后端数据为前端格式
        const chatHistory: ChatMessage[] = messages.map((msg: any) => ({
          id: msg.id,
          session_id: sessionId,
          type: msg.type,
          content: msg.content || '',
          images: msg.images || [],
          timestamp: msg.timestamp,
          params: msg.params || undefined,
        }));
        
        set({ chatHistory });
      } catch (error) {
        console.error('加载会话历史失败:', error);
      }
    } else {
      // 游客模式：加载指定会话的历史并从 IndexedDB 恢复图片
      const historyWithoutImages = loadGuestSessionHistory(sessionId);
      
      // 异步恢复图片数据
      import('../utils/helpers').then(async ({ restoreSessionImages }) => {
        try {
          const chatHistory = await restoreSessionImages(sessionId, historyWithoutImages);
          set({ chatHistory });
        } catch (error) {
          console.error('恢复图片数据失败:', error);
          set({ chatHistory: historyWithoutImages }); // 失败时使用原始数据
        }
      });
      
      // 先设置不带图片的数据，避免界面空白
      set({ chatHistory: historyWithoutImages });
    }
  },
  
  // 更新会话标题
  updateSessionTitle: async (sessionId: string, title: string) => {
    set((state) => ({
      sessions: state.sessions.map(s => 
        s.id === sessionId ? { ...s, title, updated_at: Date.now() } : s
      ),
    }));
    
    if (isLoggedIn()) {
      // 登录用户：保存到后端
      try {
        await apiService.updateSessionTitle(sessionId, title);
      } catch (error) {
        console.error('更新会话标题失败:', error);
      }
    } else {
      // 游客模式：保存到 localStorage
      const state = get();
      saveGuestSessions(state.sessions);
    }
  },
  
  // 保存当前会话配置
  saveSessionConfig: () => {
    const state = get();
    if (!state.currentSessionId) return;
    
    const config = {
      workflow: state.currentWorkflow,
      prompt: state.prompt,
      lora_prompt: state.loraPrompt,
      strength: state.strength,
      count: state.count,
      images_per_row: state.imagesPerRow,
      reference_image: state.referenceImage,
      reference_image_2: state.referenceImage2,
      reference_image_3: state.referenceImage3,
      prompt_end: state.promptEnd || undefined,
      reference_image_end: state.referenceImageEnd || undefined,
      is_loop: state.isLoop,
      start_frame_count: state.startFrameCount ?? undefined,
      end_frame_count: state.endFrameCount ?? undefined,
      frame_rate: state.frameRate ?? undefined,
    };
    
    if (isLoggedIn()) {
      // 登录用户：保存到后端数据库
      apiService.updateSessionConfig(state.currentSessionId, config)
        .catch(err => console.error('保存会话配置失败:', err));
    } else {
      // 游客模式：保存到 localStorage
      saveGuestSessionConfig(state.currentSessionId, {
        workflow: config.workflow,
        prompt: config.prompt,
        loraPrompt: config.lora_prompt,
        strength: config.strength,
        count: config.count,
        imagesPerRow: config.images_per_row,
        referenceImage: config.reference_image,
        referenceImage2: config.reference_image_2 || undefined,
        referenceImage3: config.reference_image_3 || undefined,
        promptEnd: config.prompt_end,
        referenceImageEnd: config.reference_image_end,
        isLoop: config.is_loop,
        startFrameCount: config.start_frame_count,
        endFrameCount: config.end_frame_count,
        frameRate: config.frame_rate,
      });
    }
  },
  
  // 加载指定会话的配置
  loadSessionConfig: async (sessionId: string) => {
    if (isLoggedIn()) {
      // 登录用户：从后端加载
      try {
        const config = await apiService.getSessionConfig(sessionId);
        set({
          currentWorkflow: config.workflow || DEFAULT_CONFIG.WORKFLOW,
          prompt: config.prompt || DEFAULT_CONFIG.PROMPT,
          loraPrompt: config.lora_prompt || DEFAULT_CONFIG.LORA_PROMPT,
          strength: config.strength ?? DEFAULT_CONFIG.STRENGTH,
          count: config.count ?? DEFAULT_CONFIG.COUNT,
          imagesPerRow: config.images_per_row ?? DEFAULT_CONFIG.IMAGES_PER_ROW,
          referenceImage: config.reference_image || null,
          referenceImage2: (config as any).reference_image_2 || null,
          referenceImage3: (config as any).reference_image_3 || null,
          promptEnd: config.prompt_end || '',
          referenceImageEnd: config.reference_image_end || null,
          isLoop: (config as any).is_loop ?? false,
          startFrameCount: (config as any).start_frame_count ?? null,
          endFrameCount: (config as any).end_frame_count ?? null,
          frameRate: (config as any).frame_rate ?? null,
          workflowImageStash: {},
        });
      } catch (error) {
        console.error('加载会话配置失败:', error);
        // 失败时使用默认配置
        set({
          currentWorkflow: DEFAULT_CONFIG.WORKFLOW,
          prompt: DEFAULT_CONFIG.PROMPT,
          loraPrompt: DEFAULT_CONFIG.LORA_PROMPT,
          strength: DEFAULT_CONFIG.STRENGTH,
          count: DEFAULT_CONFIG.COUNT,
          imagesPerRow: DEFAULT_CONFIG.IMAGES_PER_ROW,
          referenceImage: null,
          referenceImage2: null,
          referenceImage3: null,
          promptEnd: '',
          referenceImageEnd: null,
          isLoop: false,
          startFrameCount: null,
          endFrameCount: null,
          frameRate: null,
          workflowImageStash: {},
        });
      }
    } else {
      // 游客模式：从 localStorage 加载
      const config = loadGuestSessionConfig(sessionId);
      if (config) {
        set({
          currentWorkflow: config.workflow || DEFAULT_CONFIG.WORKFLOW,
          prompt: config.prompt || DEFAULT_CONFIG.PROMPT,
          loraPrompt: config.loraPrompt || DEFAULT_CONFIG.LORA_PROMPT,
          strength: config.strength ?? DEFAULT_CONFIG.STRENGTH,
          count: config.count ?? DEFAULT_CONFIG.COUNT,
          imagesPerRow: config.imagesPerRow ?? DEFAULT_CONFIG.IMAGES_PER_ROW,
          referenceImage: config.referenceImage || null,
          referenceImage2: (config as any).referenceImage2 || null,
          referenceImage3: (config as any).referenceImage3 || null,
          promptEnd: config.promptEnd || '',
          referenceImageEnd: config.referenceImageEnd || null,
          isLoop: (config as any).isLoop ?? false,
          startFrameCount: (config as any).startFrameCount ?? null,
          endFrameCount: (config as any).endFrameCount ?? null,
          frameRate: (config as any).frameRate ?? null,
          workflowImageStash: {},
        });
      } else {
        // 如果没有保存的配置，使用当前 store 值（已由 loadDefaultConfig 设置）
        // 不覆盖，以免丢失从后端加载的默认值
        const currentState = get();
        set({
          currentWorkflow: currentState.currentWorkflow || DEFAULT_CONFIG.WORKFLOW,
          // 保持 prompt, loraPrompt, strength, count 等值不变
          referenceImage: null,
          referenceImage2: null,
          referenceImage3: null,
        });
      }
    }
  },
}));
