/**
 * 应用状态管理 (Zustand)
 */
import { create } from 'zustand';
import { apiService } from '../api/services';
import { isLoggedIn, loadGuestConfig, saveGuestConfig, loadGuestChatHistory, saveGuestChatHistory } from '../utils/helpers';
import { DEFAULT_CONFIG } from '../utils/constants';

interface ChatMessage {
  id: string;
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
  
  // Actions
  setServiceStatus: (status: { available: boolean; is_generating: boolean; is_generating_prompt: boolean }) => void;
  setCurrentWorkflow: (workflow: string) => void;
  setPrompt: (prompt: string) => void;
  setLoraPrompt: (prompt: string) => void;
  setStrength: (strength: number) => void;
  setCount: (count: number) => void;
  setImagesPerRow: (count: number) => void;
  setReferenceImage: (image: string | null) => void;
  addChatMessage: (prompt: string, workflow: string, strength: number, count: number, loraPrompt?: string) => string;
  updateChatImages: (messageId: string, images: string[]) => void;
  appendChatImage: (messageId: string, image: string, index: number) => void;
  clearChatHistory: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  reset: () => void;
  stopGeneration: () => void;
  loadAvailableWorkflows: () => Promise<void>;
  loadUserConfig: () => Promise<void>;
  saveUserConfig: () => Promise<void>;
  loadChatHistory: () => Promise<void>;
  saveChatMessage: (message: ChatMessage) => Promise<void>;
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

export const useAppStore = create<AppState>((set) => ({
  // 初始状态
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
  
  // Actions
  setServiceStatus: (status) => set({
    isServiceAvailable: status.available,
    isGenerating: status.is_generating,
    isGeneratingPrompt: status.is_generating_prompt,
  }),
  
  setCurrentWorkflow: async (workflow) => {
    set({ currentWorkflow: workflow });
    if (isLoggedIn()) {
      try {
        await apiService.updateUserConfig({ current_workflow: workflow });
      } catch (error) {
        console.error('保存工作流配置失败:', error);
      }
    } else {
      const state = useAppStore.getState();
      saveGuestConfig({
        currentWorkflow: workflow,
        prompt: state.prompt,
        loraPrompt: state.loraPrompt,
        strength: state.strength,
        count: state.count,
        imagesPerRow: state.imagesPerRow,
      });
    }
  },
  setPrompt: async (prompt) => {
    set({ prompt });
    if (isLoggedIn()) {
      try {
        await apiService.updateUserConfig({ prompt });
      } catch (error) {
        console.error('保存提示词配置失败:', error);
      }
    } else {
      const state = useAppStore.getState();
      saveGuestConfig({
        currentWorkflow: state.currentWorkflow,
        prompt,
        loraPrompt: state.loraPrompt,
        strength: state.strength,
        count: state.count,
        imagesPerRow: state.imagesPerRow,
      });
    }
  },
  setLoraPrompt: async (prompt) => {
    set({ loraPrompt: prompt });
    if (isLoggedIn()) {
      try {
        await apiService.updateUserConfig({ lora_prompt: prompt });
      } catch (error) {
        console.error('保存 LoRA 配置失败:', error);
      }
    } else {
      const state = useAppStore.getState();
      saveGuestConfig({
        currentWorkflow: state.currentWorkflow,
        prompt: state.prompt,
        loraPrompt: prompt,
        strength: state.strength,
        count: state.count,
        imagesPerRow: state.imagesPerRow,
      });
    }
  },
  setStrength: async (strength) => {
    set({ strength });
    if (isLoggedIn()) {
      try {
        await apiService.updateUserConfig({ strength });
      } catch (error) {
        console.error('保存强度配置失败:', error);
      }
    } else {
      const state = useAppStore.getState();
      saveGuestConfig({
        currentWorkflow: state.currentWorkflow,
        prompt: state.prompt,
        loraPrompt: state.loraPrompt,
        strength,
        count: state.count,
        imagesPerRow: state.imagesPerRow,
      });
    }
  },
  setCount: async (count) => {
    set({ count });
    if (isLoggedIn()) {
      try {
        await apiService.updateUserConfig({ count });
      } catch (error) {
        console.error('保存数量配置失败:', error);
      }
    } else {
      const state = useAppStore.getState();
      saveGuestConfig({
        currentWorkflow: state.currentWorkflow,
        prompt: state.prompt,
        loraPrompt: state.loraPrompt,
        strength: state.strength,
        count,
        imagesPerRow: state.imagesPerRow,
      });
    }
  },
  setImagesPerRow: async (count) => {
    set({ imagesPerRow: count });
    if (isLoggedIn()) {
      try {
        await apiService.updateUserConfig({ images_per_row: count });
      } catch (error) {
        console.error('保存显示配置失败:', error);
      }
    } else {
      const state = useAppStore.getState();
      saveGuestConfig({
        currentWorkflow: state.currentWorkflow,
        prompt: state.prompt,
        loraPrompt: state.loraPrompt,
        strength: state.strength,
        count: state.count,
        imagesPerRow: count,
      });
    }
  },
  setReferenceImage: async (image) => {
    set({ referenceImage: image });
    
    // 持久化参考图
    if (isLoggedIn()) {
      try {
        if (image) {
          await apiService.saveReferenceImage({ image });
        } else {
          await apiService.clearReferenceImage();
        }
      } catch (err) {
        console.error('保存参考图失败:', err);
      }
    } else {
      // 游客模式存到 localStorage
      const config = loadGuestConfig();
      saveGuestConfig({ ...config, referenceImage: image });
    }
  },
  addChatMessage: (prompt, workflow, strength, count, loraPrompt) => {
    const messageId = `msg-${Date.now()}`;
    const userMessage: ChatMessage = {
      id: messageId,
      type: 'user',
      content: prompt,
      timestamp: Date.now(),
      params: { workflow, strength, count, loraPrompt }
    };
    const assistantMessage: ChatMessage = {
      id: `${messageId}-reply`,
      type: 'assistant',
      content: '',
      images: [{ loading: true as const }],
      timestamp: Date.now(),
      params: { workflow, strength, count, loraPrompt } // 存储总数用于判断
    };
    set((state) => {
      const newHistory = [...state.chatHistory, userMessage, assistantMessage];
      // 游客模式：保存到 localStorage
      if (!isLoggedIn()) {
        saveGuestChatHistory(newHistory);
      }
      return { 
        chatHistory: newHistory,
        currentGeneratingMessageId: `${messageId}-reply` // 设置当前生成任务ID
      };
    });
    
    // 登录用户：异步保存用户消息
    if (isLoggedIn()) {
      apiService.saveChatMessage({
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
      // 游客模式：保存到 localStorage
      if (!isLoggedIn()) {
        saveGuestChatHistory(newHistory);
      }
      return { chatHistory: newHistory };
    });
    
    // 登录用户：异步保存 AI 消息
    if (isLoggedIn()) {
      const state = useAppStore.getState();
      const message = state.chatHistory.find(msg => msg.id === messageId);
      if (message && message.type === 'assistant') {
        apiService.saveChatMessage({
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
      // 游客模式：保存到 localStorage
      if (!isLoggedIn()) {
        saveGuestChatHistory(newHistory);
      }
      return { chatHistory: newHistory };
    });
  },
  clearChatHistory: () => set({ chatHistory: [] }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
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
  
  // 加载聊天历史
  loadChatHistory: async () => {
    if (!isLoggedIn()) {
      // 游客模式：从 localStorage 加载
      const chatHistory = loadGuestChatHistory();
      set({ chatHistory });
      return;
    }
    
    try {
      const response: any = await apiService.getChatHistory(50);
      const messages = response.messages || [];
      
      // 转换后端数据为前端格式
      const chatHistory: ChatMessage[] = messages.map((msg: any) => ({
        id: msg.id, // 后端返回的字段是 id 不是 message_id
        type: msg.type,
        content: msg.content || '',
        images: msg.images || [],
        timestamp: msg.timestamp, // 后端已经返回了毫秒时间戳
        params: msg.params || undefined, // 直接使用后端的 params
      }));
      
      set({ chatHistory });
    } catch (error) {
      console.error('加载聊天历史失败:', error);
    }
  },
  
  // 保存单条消息
  saveChatMessage: async (message: ChatMessage) => {
    try {
      await apiService.saveChatMessage({
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
}));
