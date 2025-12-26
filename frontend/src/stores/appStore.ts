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
import { saveImages } from '../utils/indexedDB';
import { DEFAULT_CONFIG } from '../utils/constants';
import type { ChatSession } from '../types/models';

interface ChatMessage {
  id: string;
  session_id: string; // 关联会话ID
  type: 'user' | 'assistant';
  content: string; // 用户输入的提示词
  images?: (string | { loading: true })[]; // 生成的图片或加载状态
  timestamp: number;
  params?: {
    workflow: string;
    strength: number;
    count: number;
    loraPrompt?: string; // LoRA 提示词
  };
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
  availableWorkflows: string[]; // 可用工作流列表（动态从后端获取）
  
  // Prompt
  prompt: string;
  loraPrompt: string;
  
  // 参数
  strength: number;
  count: number;
  imagesPerRow: number; // 每行显示图片数量
  
  // 参考图片
  referenceImage: string | null;
  
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
  setStrength: (strength: number) => void;
  setCount: (count: number) => void;
  setImagesPerRow: (count: number) => void;
  setReferenceImage: (image: string | null) => void;
  addChatMessage: (prompt: string, workflow: string, strength: number, count: number, loraPrompt?: string) => Promise<string>;
  updateChatImages: (messageId: string, images: string[]) => void;
  appendChatImage: (messageId: string, image: string, index: number) => void;
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
  strength: initialConfig.strength,
  count: initialConfig.count,
  imagesPerRow: initialConfig.imagesPerRow,
  referenceImage: initialConfig.referenceImage,
  chatHistory: [],
  loading: false,
  error: null,
  sidebarCollapsed: localStorage.getItem('sidebarCollapsed') === 'true',
  
  // Actions
  setServiceStatus: (status) => set({
    isServiceAvailable: status.available,
    isGenerating: status.is_generating,
    isGeneratingPrompt: status.is_generating_prompt,
  }),
  
  setCurrentWorkflow: async (workflow) => {
    set({ currentWorkflow: workflow });
    const state = get();
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
  setReferenceImage: async (image) => {
    set({ referenceImage: image });
    const state = get();
    state.saveSessionConfig();
  },
  addChatMessage: async (prompt, workflow, strength, count, loraPrompt) => {
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
            created_at: response.created_at * 1000, // 转换为毫秒
            updated_at: response.updated_at * 1000,
            message_count: 0,
          };
          set({ 
            sessions: [...state.sessions, newSession],
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
          sessions: [...state.sessions, newSession],
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
      params: { workflow, strength, count, loraPrompt }
    };
    const assistantMessage: ChatMessage = {
      id: `${messageId}-reply`,
      session_id: sessionId,
      type: 'assistant',
      content: '',
      images: [{ loading: true as const }],
      timestamp: Date.now(),
      params: { workflow, strength, count, loraPrompt } // 存储总数用于判断
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
          // 保存图片到 IndexedDB
          const validImages = images.filter(img => typeof img === 'string') as string[];
          if (validImages.length > 0) {
            saveImages(message.session_id, messageId, validImages)
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
  appendChatImage: (messageId: string, image: string, index: number) => {
    set((state) => {
      const newHistory = state.chatHistory.map((msg) => {
        if (msg.id === messageId && msg.images) {
          const totalCount = msg.params?.count || 0;
          const newImages = [...msg.images];
          
          // 确保数组长度足够（预留位置）
          while (newImages.length < totalCount) {
            newImages.push({ loading: true as const });
          }
          
          // 直接根据 index 替换对应位置的图片
          if (index >= 0 && index < totalCount) {
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
            // 保存单张图片到 IndexedDB
            import('../utils/indexedDB').then(({ saveImage }) => {
              saveImage(message.session_id, messageId, image, index)
                .catch(err => console.error('保存图片到 IndexedDB 失败:', err));
            });
          }
          // 保存消息元数据到 localStorage
          saveGuestSessionHistory(state.currentSessionId, newHistory);
        }
      }
      
      return { chatHistory: newHistory };
    });
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
        // 从 workflows 配置中获取 t2i 的默认值
        const t2iDefaults = defaults.workflows?.t2i || {};
        
        // 游客模式下：如果当前 loraPrompt 为空，则更新为后端默认值
        if (!isLoggedIn()) {
          const currentState = get();
          if (!currentState.loraPrompt) {
            set({
              loraPrompt: t2iDefaults.lora_prompt || '',
              prompt: currentState.prompt || t2iDefaults.prompt || DEFAULT_CONFIG.PROMPT,
              strength: currentState.strength ?? t2iDefaults.strength ?? DEFAULT_CONFIG.STRENGTH,
              count: currentState.count ?? t2iDefaults.count ?? DEFAULT_CONFIG.COUNT,
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
      if (workflows.length > 0 && !workflows.includes(state.currentWorkflow)) {
        state.setCurrentWorkflow(defaultWorkflow || workflows[0]);
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
      
      // 如果没有会话，创建默认会话
      if (sessions.length === 0) {
        const defaultSession: ChatSession = {
          id: 'guest-session',
          title: '新对话',
          created_at: Date.now(),
          updated_at: Date.now(),
          message_count: 0,
        };
        sessions = [defaultSession];
        saveGuestSessions(sessions);
      }
      
      // 恢复上次选中的会话
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
    
    // 新会话始终从后端加载默认配置
    let backendDefaults = null;
    try {
      const response = await apiService.getWorkflowDefaults();
      if (response.success && response.defaults) {
        backendDefaults = response.defaults.workflows?.t2i || {};
      }
    } catch (error) {
      console.error('加载后端默认配置失败:', error);
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
    
    // 为新会话初始化配置（从后端默认配置读取）
    const newSessionConfig = {
      workflow: 't2i',
      prompt: backendDefaults?.prompt || DEFAULT_CONFIG.PROMPT,
      loraPrompt: backendDefaults?.lora_prompt || '',
      strength: backendDefaults?.strength ?? DEFAULT_CONFIG.STRENGTH,
      count: backendDefaults?.count ?? DEFAULT_CONFIG.COUNT,
      imagesPerRow: DEFAULT_CONFIG.IMAGES_PER_ROW,
      referenceImage: null,
    };
    
    if (isLoggedIn()) {
      // 登录用户：保存到后端
      try {
        // 后端会生成自己的 session_id，这里只传 title
        const response = await apiService.createSession(newTitle);
        const realSessionId = response.session_id;
        
        // 更新为后端返回的真实 session_id
        set((state) => ({
          sessions: state.sessions.map(s => 
            s.id === sessionId 
              ? { ...s, id: realSessionId, created_at: response.created_at * 1000, updated_at: response.updated_at * 1000 }
              : s
          ),
          currentSessionId: realSessionId
        }));
        
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
          referenceImage: null
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
        referenceImage: null
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
          strength: config.strength !== undefined ? config.strength : DEFAULT_CONFIG.STRENGTH,
          count: config.count !== undefined ? config.count : DEFAULT_CONFIG.COUNT,
          imagesPerRow: config.images_per_row !== undefined ? config.images_per_row : DEFAULT_CONFIG.IMAGES_PER_ROW,
          referenceImage: config.reference_image || null,
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
          strength: config.strength !== undefined ? config.strength : DEFAULT_CONFIG.STRENGTH,
          count: config.count !== undefined ? config.count : DEFAULT_CONFIG.COUNT,
          imagesPerRow: config.imagesPerRow !== undefined ? config.imagesPerRow : DEFAULT_CONFIG.IMAGES_PER_ROW,
          referenceImage: config.referenceImage || null,
        });
      } else {
        // 如果没有保存的配置，使用当前 store 值（已由 loadDefaultConfig 设置）
        // 不覆盖，以免丢失从后端加载的默认值
        const currentState = get();
        set({
          currentWorkflow: currentState.currentWorkflow || DEFAULT_CONFIG.WORKFLOW,
          // 保持 prompt, loraPrompt, strength, count 等值不变
          referenceImage: null,
        });
      }
    }
  },
}));
