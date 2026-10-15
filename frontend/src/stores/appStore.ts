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
  deleteGuestSessionConfig,
  restoreSessionImages
} from '../utils/helpers';
import { saveImage, saveImages, deleteMessageImages } from '../utils/indexedDB';
import { clearScrollPosition } from '../utils/scrollPosition';
import { findRepeatedGeneration } from '../utils/repeatedGeneration';
import { SessionSaveQueue } from '../utils/sessionSaveQueue';
import { DEFAULT_CONFIG } from '../utils/constants';
import type { ChatSession, ChatMessage, ApiChatMessage } from '../types/models';
import { createGenerationSlice, type GenerationSlice } from '../features/generation/slice';
import type { MotionPromptSnapshot, PromptPreset, PromptPresetChoices, WorkflowMetadata, WorkflowParameterValue } from '../types/api';
import { rememberWorkflowPromptPreset, resolveWorkflowPromptPreset, restorePromptPresetChoices } from '../utils/promptPresets';
import { motionPromptSource, resolveMotionPrompt } from '../utils/motionPrompt';
import { alignSeeds, buildMediaSeeds, clearFixedSeeds } from '../utils/generationSeed';
import { consumeSessionLink } from '../features/agent/deepLink';
import { carryReferenceImages, compactReferenceImages, getImageGenerationSettings, getGenerationCount, getWorkflowOptions, NO_PARKED_REFERENCES, resolveAvailableWorkflow, restoreWorkflowSelection, getWorkflowMethodKey, rememberWorkflowMethod, resolveInputWorkflow, resolveInputLora, type ParkedReferences } from '../utils/workflowOptions';
import { compactImageReferences, getImageMentionError, getPresetBlocker, supportsImageMentions } from '../utils/imageMentions';
import { getMotionReferenceError, isMotionVideoUrl, MAX_MOTION_REFERENCES } from '../utils/motionReferences';
import { captureComposer, fromApiInputDrafts, inputGroupOf, switchComposer, toApiInputDrafts, type ComposerDrafts } from '../utils/composerDrafts';


/** loaded：合并了一页；end：没有更早记录；error：请求失败；stale：会话已切换 */
export type EarlierMessagesResult = 'loaded' | 'end' | 'error' | 'stale';

export interface GenerationSettingsDraft {
  workflow: string;
  strength: number;
  count: number;
  loraPrompt: string;
  width: number | null;
  height: number | null;
  useOriginalSize: boolean;
  selectOptions: Record<string, WorkflowParameterValue>;
}

export interface AppState extends GenerationSlice {
  // 聊天会话
  sessions: ChatSession[];
  currentSessionId: string | null;
  composerSessionId: string | null;
  sessionConfigStatus: 'idle' | 'loading' | 'ready' | 'error';
  sessionConfigError: string | null;
  sessionConfigSaveError: string | null;
  
  // 聊天历史
  chatHistory: ChatMessage[];
  hasEarlierMessages: boolean;
  isLoadingEarlierMessages: boolean;
  // 服务状态
  isServiceAvailable: boolean;
  serviceStatusChecked: boolean;
  isGeneratingPrompt: boolean;
  
  // 当前工作流
  currentWorkflow: string;
  availableWorkflows: WorkflowMetadata[]; // 可用工作流列表（动态从后端获取）
  
  // Prompt
  prompt: string;
  loraPrompt: string;
  promptPreset: PromptPreset | null; // 输入框上方所选预设（快照），prompt 只存用户描述
  promptPresetChoices: PromptPresetChoices;
  availablePromptPresets: PromptPreset[];
  
  // 参数
  strength: number;
  count: number;
  imagesPerRow: number; // 每行显示图片数量
  width: number | null;  // 图像宽度（部分工作流支持）
  height: number | null; // 图像高度（部分工作流支持）
  useOriginalSize: boolean; // 是否使用原图尺寸（默认开启）
  // PixelLab 动画参数
  pixelLabAction: string;        // 动画动作
  pixelLabView: string;          // 视角
  pixelLabDirection: string;      // 朝向
  // select 类型参数的运行时值（按参数名存，如 { duration, aspect_ratio, resolution }），跨工作流共享；切换工作流时按当前可选项校验、必要时重置；仅前端 localStorage 持久化
  selectOptions: Record<string, WorkflowParameterValue>;

  // 各多方式分组（如图生图、图生视频）记住的上次所选方式：category -> workflow key
  rememberedMethod: Record<string, string>;
  
  // 参考图片：有序槽位（含空位），@图片N 指槽位号 N；容量由工作流元数据 max_reference_images 决定
  referenceImages: (string | null)[];
  referenceImageEnd: string | null; // 视频尾帧
  motionReferenceImages: string[];
  // 动作视频（/uploads/reference/...mp4），与动作参考图二选一
  motionReferenceVideo: string | null;
  motionPrompt: MotionPromptSnapshot | null;

  // 目标方式放不下的参考图（如文生图、单图视频）：切回可容纳的方式时自动回到输入栏
  parkedReferences: ParkedReferences;

  // 生图 / 生视频各一套输入栏：另一类的描述、图片与暂存图保存在这里，切回时恢复
  inputDrafts: ComposerDrafts;

  // 用户发送一轮后递增：结果区据此滚到底部，不论之前是否停在底部
  scrollToLatestRequest: number;

  // 各生成方式记住的生成设置（切换方式时输入栏不变，仅设置按方式恢复）
  workflowSettingsStash: Record<string, {
    loraPrompt: string;   // 工作流独立 LoRA prompt
    width?: number | null;
    height?: number | null;
    useOriginalSize?: boolean;
  }>;
  
  // UI 状态
  loading: boolean;
  error: string | null;
  sidebarCollapsed: boolean;
  
  // Actions
  setServiceStatus: (status: { available: boolean; is_generating?: boolean; is_generating_prompt?: boolean }) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setCurrentWorkflow: (workflow: string) => void;
  syncInputWorkflow: (remember?: boolean) => void;
  commitGenerationSettings: (draft: GenerationSettingsDraft) => void;
  setPrompt: (prompt: string) => void;
  setLoraPrompt: (prompt: string) => void;
  setPromptPreset: (preset: PromptPreset | null) => void;
  syncPromptPreset: () => void;
  loadPromptPresets: () => Promise<PromptPreset[]>;
  setStrength: (strength: number) => void;
  setCount: (count: number) => void;
  setImagesPerRow: (count: number) => void;
  setWidth: (width: number | null) => void;
  setHeight: (height: number | null) => void;
  setUseOriginalSize: (v: boolean) => void;
  setPixelLabAction: (v: string) => void;
  setPixelLabView: (v: string) => void;
  setPixelLabDirection: (v: string) => void;
  setSelectOption: (name: string, value: WorkflowParameterValue) => void;
  setReferenceImage: (image: string | null) => void;
  setReferenceImages: (images: readonly (string | null | undefined)[]) => void;
  setReferenceImageAt: (index: number, image: string | null) => void;
  setReferenceImageEnd: (image: string | null) => void;
  setMotionReferenceImages: (images: string[]) => void;
  setMotionReferenceVideo: (video: string | null) => void;
  setMotionPrompt: (snapshot: MotionPromptSnapshot | null) => void;
  addChatMessage: (params: { prompt: string; workflow: string; strength: number | undefined; count: number; loraPrompt?: string; width?: number; height?: number; useOriginalSize?: boolean; referenceImages?: readonly (string | null | undefined)[]; referenceImageEnd?: string | null; workflowOptions?: Record<string, WorkflowParameterValue>; promptPreset?: PromptPreset | null; motionReferenceImages?: string[]; motionReferenceVideo?: string | null; motionPrompt?: MotionPromptSnapshot }) => Promise<{ messageId: string; sessionId: string; appendResults?: boolean } | null>;
  updateChatImages: (messageId: string, images: string[], persist?: boolean) => void;
  appendChatMedia: (messageId: string, image: string, index: number, seed?: number | null) => void;
  deleteChatMessage: (messageId: string) => Promise<void>;
  deleteChatMedia: (messageId: string, images: string[]) => Promise<void>;
  editAndRegenerateMessage: (
    userMsgId: string,
    newContent: string,
    newRefImages: { referenceImages?: readonly (string | null | undefined)[]; referenceImageEnd?: string | null; motionReferenceImages?: string[]; motionReferenceVideo?: string | null; motionPrompt?: MotionPromptSnapshot | null },
    newPromptPreset?: PromptPreset | null
  ) => Promise<void>;
  clearChatHistory: () => void;
  loadEarlierMessages: () => Promise<EarlierMessagesResult>;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  reset: () => void;
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
  setSessionPinned: (sessionId: string, pinned: boolean) => Promise<void>;
  
  // 会话配置管理
  saveSessionConfig: (immediate?: boolean) => Promise<boolean>;
  loadSessionConfig: (sessionId: string) => Promise<void>;
}

export const buildWorkflowTransition = (state: AppState, workflow: string): Partial<AppState> => {
  workflow = resolveAvailableWorkflow(workflow, state.availableWorkflows);
  const sourceMethod = getWorkflowMethodKey(state.currentWorkflow, state.availableWorkflows);
  const targetMethod = getWorkflowMethodKey(workflow, state.availableWorkflows);
  // 生图与生视频各用一套输入栏：跨类切换时存下当前输入，换回目标类上次的输入。
  // 同一类里切换不改写输入栏：文字原样保留，参考图能放下就带走，放不下的先暂存。
  const currentMeta = state.availableWorkflows.find(item => item.key === state.currentWorkflow);
  const requestedMeta = state.availableWorkflows.find(item => item.key === workflow);
  const switched = currentMeta && requestedMeta
    ? switchComposer(captureComposer(state), state.inputDrafts, inputGroupOf(currentMeta), inputGroupOf(requestedMeta))
    : { composer: captureComposer(state), drafts: state.inputDrafts };
  const source = switched.composer;
  const composer = source.referenceImages;
  const carryInto = (key: string) => carryReferenceImages(
    state.availableWorkflows.find(item => item.key === key),
    composer, source.referenceImageEnd, source.parkedReferences);
  workflow = resolveInputWorkflow(workflow, state.availableWorkflows, carryInto(workflow).images);
  const workflowMeta = state.availableWorkflows.find(item => item.key === workflow);
  if (!workflowMeta) return { currentWorkflow: workflow };
  const carried = carryInto(workflow);

  const updates: Partial<AppState> = {
    ...resolveWorkflowPromptPreset(workflowMeta, state.availablePromptPresets, state.promptPresetChoices, state.promptPreset),
    currentWorkflow: workflow,
    useOriginalSize: true,
    prompt: source.prompt,
    referenceImages: carried.images,
    motionPrompt: (carried.images[0] ?? null) === (source.referenceImages[0] ?? null) ? source.motionPrompt : null,
    referenceImageEnd: carried.endImage,
    motionReferenceImages: source.motionReferenceImages,
    motionReferenceVideo: source.motionReferenceVideo,
    parkedReferences: carried.parked,
    inputDrafts: switched.drafts,
  };
  // 提示词原样保留：多图方式容量相同，带走的图片编号不变，暂存的图片回来时编号也回到原位。
  const parameterNames = new Set(workflowMeta.parameters.map(param => param.name));

  workflowMeta.parameters.forEach(param => {
    if (param.name === 'strength') updates.strength = Number(param.default);
    if (param.name === 'count') updates.count = Number(param.default);
    if (param.name === 'lora_prompt') updates.loraPrompt = String(param.default);
    if (param.name === 'width') updates.width = Number(param.default);
    if (param.name === 'height') updates.height = Number(param.default);
  });

  if (!parameterNames.has('lora_prompt')) updates.loraPrompt = '';
  if (!parameterNames.has('strength')) updates.strength = DEFAULT_CONFIG.STRENGTH;
  if (!parameterNames.has('count')) updates.count = DEFAULT_CONFIG.COUNT;
  if (!parameterNames.has('width')) updates.width = null;
  if (!parameterNames.has('height')) updates.height = null;

  // 生成设置按方式记忆（输入栏内容不进暂存），切回时恢复上次的 LoRA 与尺寸。
  const stash = { ...state.workflowSettingsStash };
  stash[sourceMethod] = {
    loraPrompt: state.loraPrompt,
    width: state.width,
    height: state.height,
    useOriginalSize: state.useOriginalSize,
  };
  const saved = stash[targetMethod];
  if (saved?.loraPrompt !== undefined) updates.loraPrompt = saved.loraPrompt;
  if (saved?.width !== undefined) updates.width = saved.width;
  if (saved?.height !== undefined) updates.height = saved.height;
  if (saved?.useOriginalSize !== undefined) updates.useOriginalSize = saved.useOriginalSize;
  updates.loraPrompt = resolveInputLora(updates.loraPrompt, workflow, state.availableWorkflows);
  updates.workflowSettingsStash = stash;

  const nextSelectOptions = { ...state.selectOptions };
  workflowMeta.parameters.forEach(param => {
    if (param.type !== 'select') return;
    const current = nextSelectOptions[param.name];
    const valid = current !== undefined && (!param.options || param.options.includes(String(current)));
    if (!valid) nextSelectOptions[param.name] = param.default;
  });
  updates.selectOptions = nextSelectOptions;
  if ((updates.promptPreset?.prompt.trim() ?? '') !== (state.promptPreset?.prompt.trim() ?? '')) updates.motionPrompt = null;

  return updates;
};

const getRememberedMethodUpdate = (state: AppState, workflow: string) => {
  return rememberWorkflowMethod(state.rememberedMethod, state.availableWorkflows, workflow);
};

/** 旧数据只有三个 legacy 标量字段时组装槽位列表（去掉尾部空位）。 */
const legacyReferenceSlots = (
  first?: string | null, second?: string | null, third?: string | null,
): (string | null)[] => {
  const slots = [first ?? null, second ?? null, third ?? null];
  while (slots.length && !slots[slots.length - 1]) slots.pop();
  return slots;
};

const createLocalSessionTitle = (content: string) => {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return '新对话';
  return normalized.length > 20 ? `${normalized.slice(0, 20)}…` : normalized;
};

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

let sessionSwitchSequence = 0;
let sessionAccountEpoch = 0;
let sessionConfigLoadSequence = 0;
let promptPresetLoadSequence = 0;
const sessionConfigSaves = new SessionSaveQueue<Parameters<typeof apiService.updateSessionConfig>[1]>(
  (sessionId, config) => apiService.updateSessionConfig(sessionId, config),
  { onResult: (sessionId, saved) => {
    const state = useAppStore.getState();
    if (state.currentSessionId === sessionId && state.composerSessionId === sessionId) {
      useAppStore.setState({ sessionConfigSaveError: saved ? null : '输入内容保存失败，请重试' });
    }
  } },
);
// 同一会话的并发调用（按钮、会话位置恢复、导航条跳转）共用一次请求
let earlierMessagesRequest: { sessionId: string; promise: Promise<EarlierMessagesResult> } | null = null;

export const useAppStore = create<AppState>((set, get, store) => ({
  ...createGenerationSlice(set, get, store),
  // 初始状态
  sessions: [],
  currentSessionId: null,
  composerSessionId: null,
  sessionConfigStatus: 'idle',
  sessionConfigError: null,
  sessionConfigSaveError: null,
  isServiceAvailable: false,
  serviceStatusChecked: false,
  isGeneratingPrompt: false,
  currentWorkflow: initialConfig.currentWorkflow,
  availableWorkflows: [], // 初始为空，从后端动态获取
  prompt: initialConfig.prompt,
  loraPrompt: initialConfig.loraPrompt,
  promptPreset: null,
  promptPresetChoices: {},
  availablePromptPresets: [],
  strength: initialConfig.strength,
  count: initialConfig.count,
  imagesPerRow: initialConfig.imagesPerRow,
  width: null,  // 图像宽度，默认为 null 表示使用工作流默认值
  height: null, // 图像高度，默认为 null 表示使用工作流默认值
  useOriginalSize: true,  // 默认使用原图尺寸
  pixelLabAction: 'walk',
  pixelLabView: 'sidescroller',
  pixelLabDirection: 'east',
  selectOptions: (() => { try { return JSON.parse(localStorage.getItem('selectOptions') || '{}'); } catch { return {}; } })(),
  rememberedMethod: (() => { try { return JSON.parse(localStorage.getItem('rememberedMethod') || '{}'); } catch { return {}; } })(),
  referenceImages: [],
  referenceImageEnd: null,
  motionReferenceImages: [],
  motionReferenceVideo: null,
  motionPrompt: null,
  workflowSettingsStash: {},
  parkedReferences: NO_PARKED_REFERENCES,
  inputDrafts: {},
  scrollToLatestRequest: 0,
  chatHistory: [],
  hasEarlierMessages: false,
  isLoadingEarlierMessages: false,
  loading: false,
  error: null,
  sidebarCollapsed: localStorage.getItem('sidebarCollapsed') === 'true',
  
  // Actions
  setServiceStatus: (status) => set(state => ({
    isServiceAvailable: status.available,
    serviceStatusChecked: true,
    isGeneratingPrompt: status.is_generating_prompt ?? state.isGeneratingPrompt,
  })),
  
  setCurrentWorkflow: (workflow) => {
    const state = get();
    const updates = buildWorkflowTransition(state, workflow);
    const rememberedMethod = getRememberedMethodUpdate(state, updates.currentWorkflow ?? workflow);
    if (rememberedMethod) updates.rememberedMethod = rememberedMethod;

    set(updates);
    if (updates.selectOptions) {
      localStorage.setItem('selectOptions', JSON.stringify(updates.selectOptions));
    }
    if (rememberedMethod) {
      localStorage.setItem('rememberedMethod', JSON.stringify(rememberedMethod));
    }
    get().saveSessionConfig();
  },
  syncInputWorkflow: (remember = true) => {
    const state = get();
    const restored = restoreWorkflowSelection(state.currentWorkflow, state.loraPrompt, state.availableWorkflows);
    const workflow = resolveInputWorkflow(restored.currentWorkflow, state.availableWorkflows,
      state.referenceImages);
    const metadata = state.availableWorkflows.find(item => item.key === workflow);
    const rememberedMethod = rememberWorkflowMethod(state.rememberedMethod, state.availableWorkflows, remember ? workflow : undefined);
    set({
      currentWorkflow: workflow,
      loraPrompt: resolveInputLora(restored.loraPrompt, workflow, state.availableWorkflows),
      count: metadata ? getGenerationCount(metadata, state.count) : state.count,
      selectOptions: { ...state.selectOptions, ...getWorkflowOptions(metadata, state.selectOptions) },
      rememberedMethod,
    });
    localStorage.setItem('rememberedMethod', JSON.stringify(rememberedMethod));
    get().syncPromptPreset();
  },
  commitGenerationSettings: (draft) => {
    const state = get();
    const updates = buildWorkflowTransition(state, draft.workflow);
    const workflow = updates.currentWorkflow ?? draft.workflow;
    const rememberedMethod = getRememberedMethodUpdate(state, workflow);
    const mergedSelectOptions = {
      ...(updates.selectOptions ?? state.selectOptions),
      ...draft.selectOptions,
    };

    Object.assign(updates, {
      currentWorkflow: workflow,
      strength: draft.strength,
      count: draft.count,
      loraPrompt: resolveInputLora(draft.loraPrompt, workflow, state.availableWorkflows),
      width: draft.width,
      height: draft.height,
      useOriginalSize: draft.useOriginalSize,
      selectOptions: mergedSelectOptions,
    });
    if (rememberedMethod) updates.rememberedMethod = rememberedMethod;

    set(updates);
    localStorage.setItem('selectOptions', JSON.stringify(mergedSelectOptions));
    if (rememberedMethod) {
      localStorage.setItem('rememberedMethod', JSON.stringify(rememberedMethod));
    }
    get().saveSessionConfig();
  },
  setPrompt: async (prompt) => {
    set({ prompt, motionPrompt: null });
    const state = get();
    state.saveSessionConfig();
  },
  setLoraPrompt: async (prompt) => {
    set({ loraPrompt: prompt });
    const state = get();
    state.saveSessionConfig();
  },
  setPromptPreset: (promptPreset) => {
    set(state => {
      const metadata = state.availableWorkflows.find(item => item.key === state.currentWorkflow);
      return { promptPreset, motionPrompt: null,
        promptPresetChoices: metadata
          ? rememberWorkflowPromptPreset(metadata, promptPreset, state.promptPresetChoices)
          : { ...state.promptPresetChoices, [state.currentWorkflow]: promptPreset } };
    });
    get().saveSessionConfig();
  },
  syncPromptPreset: () => {
    const state = get();
    if (state.currentSessionId && (state.sessionConfigStatus !== 'ready' || state.composerSessionId !== state.currentSessionId)) return;
    const selection = resolveWorkflowPromptPreset(
      state.availableWorkflows.find(item => item.key === state.currentWorkflow),
      state.availablePromptPresets, state.promptPresetChoices, state.promptPreset,
    );
    if (selection.promptPreset === state.promptPreset && selection.promptPresetChoices === state.promptPresetChoices) return;
    // Restored snapshots are separate objects; only a changed prompt prefix invalidates pose analysis.
    const samePrompt = (selection.promptPreset?.prompt.trim() ?? '') === (state.promptPreset?.prompt.trim() ?? '');
    set({ ...selection, motionPrompt: samePrompt ? state.motionPrompt : null });
    get().saveSessionConfig();
  },
  loadPromptPresets: async () => {
    const sequence = ++promptPresetLoadSequence;
    const { presets } = await apiService.getPromptPresets();
    if (sequence === promptPresetLoadSequence) {
      set({ availablePromptPresets: presets });
      get().syncPromptPreset();
    }
    return presets;
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
  setReferenceImages: (images) => {
    const state = get();
    const metadata = state.availableWorkflows.find(item => item.key === state.currentWorkflow);
    const next = supportsImageMentions(metadata)
      ? compactImageReferences(state.prompt, images)
      : { prompt: state.prompt, images: images.map(image => image ?? null) };
    set({ prompt: next.prompt, referenceImages: next.images,
      motionPrompt: (next.images[0] ?? null) === (state.referenceImages[0] ?? null) ? state.motionPrompt : null });
    get().syncInputWorkflow();
    get().saveSessionConfig();
  },
  setReferenceImage: (image) => get().setReferenceImages([image, ...get().referenceImages.slice(1)]),
  setReferenceImageAt: (index, image) => {
    const images: (string | null)[] = [...get().referenceImages];
    while (images.length <= index) images.push(null);
    images[index] = image;
    get().setReferenceImages(images);
  },
  setMotionReferenceImages: (images) => {
    const { motionReferenceImages: previous, motionReferenceVideo } = get();
    const unchanged = previous.length === images.length && previous.every((image, index) => image === images[index]);
    // Pose images and a motion video are alternatives; adding images drops the video.
    const replacesVideo = images.length > 0 && motionReferenceVideo !== null;
    set({ motionReferenceImages: images.slice(0, MAX_MOTION_REFERENCES),
      ...(replacesVideo ? { motionReferenceVideo: null } : {}),
      motionPrompt: unchanged && !replacesVideo ? get().motionPrompt : null });
    get().saveSessionConfig();
  },
  setMotionReferenceVideo: (video) => {
    const { motionReferenceVideo, motionReferenceImages } = get();
    const replacesImages = video !== null && motionReferenceImages.length > 0;
    set({ motionReferenceVideo: video,
      ...(replacesImages ? { motionReferenceImages: [] } : {}),
      motionPrompt: video === motionReferenceVideo && !replacesImages ? get().motionPrompt : null });
    get().saveSessionConfig();
  },
  setMotionPrompt: (motionPrompt) => {
    set({ motionPrompt });
    get().saveSessionConfig();
  },
  setReferenceImageEnd: async (image) => {
    set({ referenceImageEnd: image });
    const state = get();
    state.saveSessionConfig();
  },
  setUseOriginalSize: (v) => {
    set({ useOriginalSize: v });
    get().saveSessionConfig();
  },
  setPixelLabAction: (v) => {
    set({ pixelLabAction: v });
    get().saveSessionConfig();
  },
  setPixelLabView: (v) => {
    set({ pixelLabView: v });
    get().saveSessionConfig();
  },
  setPixelLabDirection: (v) => {
    set({ pixelLabDirection: v });
    get().saveSessionConfig();
  },
  setSelectOption: (name, value) => {
    const updated = { ...get().selectOptions, [name]: value };
    set({ selectOptions: updated });
    localStorage.setItem('selectOptions', JSON.stringify(updated));
    get().saveSessionConfig();
  },
  addChatMessage: async ({ prompt, workflow, strength, count, loraPrompt, width, height, useOriginalSize, referenceImages, referenceImageEnd, workflowOptions, promptPreset, motionReferenceImages, motionReferenceVideo, motionPrompt }) => {
    const state = get();
    if (state.sessionConfigStatus === 'loading' || state.sessionConfigStatus === 'error') return null;
    if (state.currentSessionId && (state.composerSessionId !== state.currentSessionId || state.sessionConfigStatus !== 'ready')) return null;
    // 如果没有当前会话，自动创建一个
    let sessionId = state.currentSessionId;
    if (!sessionId) {
      const sequence = sessionSwitchSequence;
      // 登录用户：调用API创建真实会话
      if (isLoggedIn()) {
        try {
          const response = await apiService.createSession('新对话');
          if (sequence !== sessionSwitchSequence || get().currentSessionId !== null) return null;
          sessionId = response.session_id;
          const newSession: ChatSession = {
            id: sessionId,
            title: response.title,
            is_pinned: response.is_pinned,
            created_at: response.created_at,
            updated_at: response.updated_at,
            message_count: 0,
          };
          set({ 
            sessions: [newSession, ...state.sessions], // 新会话放在最前面
            currentSessionId: sessionId, composerSessionId: sessionId, sessionConfigStatus: 'ready', sessionConfigError: null,
          });
          get().saveSessionConfig(true);
        } catch (err) {
          console.error('创建会话失败:', err);
          set({ error: '创建会话失败，请重试' });
          return null;
        }
      } else {
        // 游客模式：创建本地会话
        const newSessionId = `session-${Date.now()}`;
        const newSession: ChatSession = {
          id: newSessionId,
          title: '新对话',
          is_pinned: false,
          created_at: Date.now(),
          updated_at: Date.now(),
          message_count: 0,
        };
        set({ 
          sessions: [newSession, ...state.sessions], // 新会话放在最前面
          currentSessionId: newSessionId, composerSessionId: newSessionId, sessionConfigStatus: 'ready', sessionConfigError: null,
        });
        sessionId = newSessionId;
      }
    }
    
    // 确保 sessionId 不为 null
    if (!sessionId) {
      console.error('无法创建消息：会话ID为空');
      set({ error: '会话创建失败，请重试' });
      return null;
    }
    const messageId = `msg-${crypto.randomUUID()}`;
    const userMessage: ChatMessage = {
      id: messageId,
      session_id: sessionId,
      type: 'user',
      content: prompt,
      timestamp: Date.now(),
      params: {
        workflow, strength, count, loraPrompt,
        width, height, useOriginalSize,
        referenceImages: referenceImages?.length ? referenceImages.map(value => value ?? null) : undefined,
        referenceImageEnd: referenceImageEnd || undefined,
        motionReferenceImages: motionReferenceImages ? [...motionReferenceImages] : undefined,
        motionReferenceVideo: motionReferenceVideo || undefined,
        motionPrompt: motionPrompt ? {...motionPrompt} : undefined,
        workflowOptions,
        promptPreset: promptPreset || undefined,
      }
    };
    const repeated = findRepeatedGeneration(get().chatHistory, sessionId, userMessage);
    if (repeated) {
      set(current => ({
        chatHistory: current.chatHistory.map(item => item.id === repeated.id ? {
          ...item, images: [...(item.images ?? []).filter(image => typeof image === 'string'), { loading: true as const }],
        } : item),
        sessions: current.sessions.map(item => item.id === sessionId ? { ...item, updated_at: Date.now() } : item),
        scrollToLatestRequest: current.scrollToLatestRequest + 1,
      }));
      get().startGeneration(repeated.id, null);
      return { messageId: repeated.id, sessionId, appendResults: true };
    }
    const assistantMessage: ChatMessage = {
      id: `${messageId}-reply`,
      session_id: sessionId,
      type: 'assistant',
      content: '',
      images: [{ loading: true as const }],
      timestamp: Date.now(),
      params: { workflow, strength, count, loraPrompt, workflowOptions } // 存储总数用于判断
    };
    set((state) => {
      const newHistory = [...state.chatHistory, userMessage, assistantMessage];
      // 更新会话的消息数量和更新时间
      const updatedSessions = state.sessions.map(s =>
        s.id === sessionId 
          ? {
              ...s,
              title: !isLoggedIn() ? createLocalSessionTitle(prompt) : s.title,
              message_count: s.message_count + 2,
              updated_at: Date.now(),
            }
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
        scrollToLatestRequest: state.scrollToLatestRequest + 1,
      };
    });
    
    get().startGeneration(`${messageId}-reply`, null);
    // 登录用户：先落库用户消息，避免助手占位消息先写入导致轮次顺序反转。
    if (isLoggedIn()) {
      try {
        await apiService.saveChatMessage({
          session_id: sessionId,
          message_id: messageId,
          type: 'user',
          content: prompt,
          workflow,
          strength,
          count,
          lora_prompt: loraPrompt,
          width, height, use_original_size: useOriginalSize,
          reference_images: referenceImages?.length ? referenceImages.map(value => value ?? null) : undefined,
          reference_image_end: referenceImageEnd || undefined,
          motion_reference_images: motionReferenceImages,
          motion_reference_video: motionReferenceVideo || undefined,
          motion_prompt: motionPrompt,
          workflow_options: workflowOptions,
          prompt_preset: promptPreset || undefined,
        });
        void apiService.summarizeSessionTitle(sessionId).then(response => {
          set(current => ({
            sessions: current.sessions.map(session =>
              session.id === sessionId ? { ...session, title: response.title } : session
            ),
          }));
        }).catch(err => console.error('总结会话标题失败:', err));
      } catch (err) {
        console.error('保存用户消息失败:', err);
        set(current => ({
          chatHistory: current.chatHistory.filter(
            message => message.id !== messageId && message.id !== `${messageId}-reply`,
          ),
          sessions: current.sessions.map(session =>
            session.id === sessionId
              ? { ...session, message_count: Math.max(0, session.message_count - 2) }
              : session
          ),
          error: '保存消息失败，请重试',
        }));
        get().finishGeneration();
        return null;
      }
    }
    
    return { messageId: `${messageId}-reply`, sessionId };
  },
  updateChatImages: (messageId, images, persist = true) => {
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
    if (persist && isLoggedIn()) {
      const state = useAppStore.getState();
      const message = state.chatHistory.find(msg => msg.id === messageId);
      if (message && message.type === 'assistant') {
        apiService.saveChatMessage({
          session_id: message.session_id,
          message_id: messageId,
          type: 'assistant',
          content: '',
          images: images.filter(img => typeof img === 'string') as string[],
          seeds: alignSeeds(images.filter(img => typeof img === 'string') as string[], message.mediaSeeds),
        }).catch(err => console.error('保存 AI 消息失败:', err));
      }
    }
  },
  appendChatMedia: (messageId: string, image: string, index: number, seed?: number | null) => {
    set((state) => {
      const newHistory = state.chatHistory.map((msg) => {
        if (msg.id === messageId && msg.images) {
          const newImages = [...msg.images];
          
          // 确保数组长度足够（扩展到 index+1），不依赖 params.count（视频工作流可能为 null）
          while (newImages.length <= index) {
            newImages.push({ loading: true as const });
          }
          
          // 直接按 index 替换
          if (index >= 0) {
            newImages[index] = image;
          }
          
          const mediaSeeds = typeof seed === 'number' ? { ...msg.mediaSeeds, [image]: seed } : msg.mediaSeeds;
          return { ...msg, images: newImages, mediaSeeds };
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
            if (!image.startsWith('data:video/') && !image.includes('/video/')) {
              saveImage(message.session_id, messageId, image, index)
                .catch(err => console.error('保存图片到 IndexedDB 失败:', err));
            }
          }
          // 保存消息元数据到 localStorage
          saveGuestSessionHistory(state.currentSessionId, newHistory);
        }
      }
      
      return { chatHistory: newHistory };
    });

    // 登录用户的后处理结果（如移除背景、精灵图）不会触发生成完成回调，
    // 需要在追加后立即持久化，否则刷新会话时会从数据库恢复为旧的图片列表。
    if (isLoggedIn()) {
      const state = useAppStore.getState();
      if (state.currentGeneratingMessageId === messageId) {
        return;
      }

      const message = state.chatHistory.find(msg => msg.id === messageId);
      if (message && message.type === 'assistant') {
        apiService.saveChatMessage({
          session_id: message.session_id,
          message_id: messageId,
          type: 'assistant',
          content: message.content || '',
          images: (message.images?.filter(img => typeof img === 'string') ?? []) as string[],
          seeds: alignSeeds((message.images?.filter(img => typeof img === 'string') ?? []) as string[], message.mediaSeeds),
        }).catch(err => console.error('保存追加媒体失败:', err));
      }
    }
  },
  deleteChatMedia: async (messageId, images) => {
    const before = get();
    const sessionId = before.currentSessionId;
    const target = before.chatHistory.find(item => item.id === messageId && item.session_id === sessionId && item.type === 'assistant');
    if (!sessionId || !target) throw new Error('找不到当前对话的图片，请刷新后重试');
    if (before.isGenerating) throw new Error('请等待生成完成后再删除图片');
    if (!isLoggedIn()) throw new Error('请登录后再删除图片');
    const selected = [...new Set(images)].filter(image => target.images?.includes(image));
    if (!selected.length) return;
    // A round fetch begun before this edit must not resurrect removed results.
    set({ generationRevision: before.generationRevision + 1 });
    // Flush the composer's pending reference save before unreferenced-file cleanup.
    if (!await before.saveSessionConfig(true)) throw new Error('请先恢复并保存输入内容，再删除图片');
    const result = await apiService.deleteMessageMedia(sessionId, messageId, selected);
    set(current => {
      if (current.currentSessionId !== sessionId || current.currentGeneratingMessageId === messageId) return current;
      return {
        generationRevision: current.generationRevision + 1,
        chatHistory: current.chatHistory.map(item => item.id === messageId && item.session_id === sessionId
          ? { ...item, images: result.images, mediaSeeds: buildMediaSeeds(result.images, result.seeds) } : item),
      };
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
  editAndRegenerateMessage: async (userMsgId, newContent, newRefImages, newPromptPreset) => {
    const state = get();
    const sessionId = state.currentSessionId;
    if (!sessionId) return;

    const msgIndex = state.chatHistory.findIndex(m => m.id === userMsgId && m.type === 'user');
    if (msgIndex === -1) return;

    const userMsg = state.chatHistory[msgIndex];
    const nextMsg = state.chatHistory[msgIndex + 1];
    if (!nextMsg || nextMsg.type !== 'assistant') return;
    const assistantMsgId = nextMsg.id;
    const params = userMsg.params!;
    if (!state.availableWorkflows.some(item => item.key === params.workflow)) {
      set({ error: '此记录使用的生成方式已停用，请选择当前可用的方式创建新任务。原结果已保留。' });
      return;
    }
    const references = newRefImages.referenceImages !== undefined
      ? [...newRefImages.referenceImages]
      : (params.referenceImages ?? legacyReferenceSlots(params.referenceImage, params.referenceImage2, params.referenceImage3));
    if (supportsImageMentions(state.availableWorkflows.find(item => item.key === params.workflow))) {
      const error = getImageMentionError(newContent, references);
      if (error) { set({ error }); return; }
      newContent = compactImageReferences(newContent, references).prompt;
    }
    const finalImages = compactReferenceImages(references);
    const workflow = resolveInputWorkflow(params.workflow, state.availableWorkflows, finalImages);
    const workflowMetadata = state.availableWorkflows.find(item => item.key === workflow);
    const finalMotionVideo = workflowMetadata?.supports_motion_reference_video
      ? (newRefImages.motionReferenceVideo !== undefined ? newRefImages.motionReferenceVideo : params.motionReferenceVideo ?? null) : null;
    // A motion video replaces the pose images of that round.
    const finalMotionImages = workflowMetadata?.supports_motion_reference
      ? (finalMotionVideo ? [] : [...(newRefImages.motionReferenceImages ?? params.motionReferenceImages ?? [])]) : undefined;
    if (finalMotionImages) {
      const error = getMotionReferenceError(finalImages[0], finalMotionImages, finalMotionVideo);
      if (error) { set({ error }); return; }
    }
    const finalImgEnd = newRefImages.referenceImageEnd !== undefined ? newRefImages.referenceImageEnd : params.referenceImageEnd;
    const finalMotionPrompt = finalMotionImages ? (newRefImages.motionPrompt !== undefined ? newRefImages.motionPrompt : params.motionPrompt) : null;
    const promptPreset = newPromptPreset !== undefined ? newPromptPreset : params.promptPreset ?? null;
    if (promptPreset) {
      const presetError = getPresetBlocker(promptPreset, workflowMetadata, finalImages, finalImgEnd, [...(finalMotionImages ?? []), finalMotionVideo]);
      if (presetError) { set({ error: `预设「${promptPreset.title}」：${presetError}` }); return; }
    }
    const effectiveLora = resolveInputLora(params.loraPrompt, workflow, state.availableWorkflows);
    const count = getGenerationCount(workflowMetadata, params.count || 1);
    const imageSettings = getImageGenerationSettings(workflowMetadata, params, finalImages.length > 0);
    const workflowOptions = getWorkflowOptions(workflowMetadata, params.workflowOptions ?? {});
    const previousAssistantImages = nextMsg.images ?? [];
    const hasExistingResult = previousAssistantImages.some(image => typeof image === 'string');
    const pendingImages = hasExistingResult
      ? previousAssistantImages
      : Array.from({ length: count }, () => ({ loading: true as const }));
    const generationTaskId = crypto.randomUUID();

    set((current) => ({
      chatHistory: current.chatHistory.map((message) => {
        if (message.id === userMsgId) {
          return {
            ...message,
            content: newContent,
            params: {
              ...message.params!,
              workflow,
              loraPrompt: effectiveLora,
              ...imageSettings,
              workflowOptions,
              referenceImage: undefined,
              referenceImage2: undefined,
              referenceImage3: undefined,
              referenceImages: finalImages.length ? finalImages : undefined,
              referenceImageEnd: finalImgEnd || undefined,
              motionReferenceImages: finalMotionImages,
              motionReferenceVideo: finalMotionVideo || undefined,
              motionPrompt: finalMotionPrompt,
              promptPreset: promptPreset || undefined,
              count,
            },
          };
        }
        if (message.id === assistantMsgId) return { ...message, images: pendingImages };
        return message;
      }),
    }));
    get().startGeneration(assistantMsgId, generationTaskId);

    if (!isLoggedIn()) saveGuestSessionHistory(sessionId, get().chatHistory);

    try {
      await apiService.generateMedia({
        prompt: newContent,
        workflow,
        strength: params.strength ?? undefined,
        lora_prompt: effectiveLora,
        count: count,
        reference_images: finalImages.length ? finalImages : undefined,
        reference_image_end: finalImgEnd || undefined,
        motion_reference_images: finalMotionImages,
        motion_reference_video: finalMotionVideo || undefined,
        motion_prompt: finalMotionPrompt?.prompt.trim() ? finalMotionPrompt : undefined,
        workflow_options: workflowOptions,
        prompt_preset: promptPreset || undefined,
        width: imageSettings.width,
        height: imageSettings.height,
        use_original_size: imageSettings.useOriginalSize,
        // 任务关联：让后端落库 + 断线恢复能定位到助手消息
        message_id: assistantMsgId,
        session_id: sessionId,
        task_id: generationTaskId,
      });
    } catch (err) {
      console.error('重新生成失败:', err);
      if (get().currentGenerationTaskId !== generationTaskId) return;
      set((current) => ({
        chatHistory: current.chatHistory.map((message) => {
          if (message.id === userMsgId) return userMsg;
          if (message.id === assistantMsgId) return { ...message, images: previousAssistantImages };
          return message;
        }),
        error: '重新生成未启动，已保留原结果',
      }));
      get().finishGeneration();
    }
  },
  clearChatHistory: () => set({ chatHistory: [], hasEarlierMessages: false }),
  loadEarlierMessages: () => {
    const state = get();
    const sessionId = state.currentSessionId;
    if (!sessionId || !isLoggedIn()) return Promise.resolve('stale');
    if (earlierMessagesRequest?.sessionId === sessionId) return earlierMessagesRequest.promise;
    if (!state.hasEarlierMessages) return Promise.resolve('end');

    const request = { sessionId } as NonNullable<typeof earlierMessagesRequest>;
    earlierMessagesRequest = request;
    set({ isLoadingEarlierMessages: true });
    request.promise = (async (): Promise<EarlierMessagesResult> => {
      try {
        const response = await apiService.getChatHistory(50, sessionId, get().chatHistory.length);
        if (get().currentSessionId !== sessionId) return 'stale';
        const olderMessages: ChatMessage[] = (response.messages as ApiChatMessage[]).map(message => ({
          id: message.id,
          session_id: sessionId,
          type: message.type,
          content: message.content || '',
          images: message.images || [],
          mediaSeeds: buildMediaSeeds(message.images, message.seeds),
          timestamp: message.timestamp,
          params: message.params || undefined,
        }));
        set(current => {
          const existingIds = new Set(current.chatHistory.map(message => message.id));
          return {
            chatHistory: [...olderMessages.filter(message => !existingIds.has(message.id)), ...current.chatHistory],
            hasEarlierMessages: response.has_more === true,
          };
        });
        return 'loaded';
      } catch (error) {
        console.error('加载更早记录失败:', error);
        return get().currentSessionId === sessionId ? 'error' : 'stale';
      } finally {
        if (earlierMessagesRequest === request) {
          earlierMessagesRequest = null;
          set({ isLoadingEarlierMessages: false });
        }
      }
    })();
    return request.promise;
  },
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
  setSidebarCollapsed: (collapsed) => {
    set({ sidebarCollapsed: collapsed });
    localStorage.setItem('sidebarCollapsed', String(collapsed));
  },
  reset: () => {
    sessionAccountEpoch += 1;
    sessionSwitchSequence += 1;
    sessionConfigLoadSequence += 1;
    sessionConfigSaves.clear();
    get().finishGeneration();
    set({
      currentSessionId: null, composerSessionId: null, sessionConfigStatus: 'idle',
      sessionConfigError: null, sessionConfigSaveError: null, sessions: [],
      prompt: '',
      loraPrompt: '',
      promptPreset: null,
      promptPresetChoices: {},
      strength: 0.5,
      count: 1,
      referenceImages: [],
      referenceImageEnd: null,
      chatHistory: [],
      motionReferenceImages: [],
      motionReferenceVideo: null,
      motionPrompt: null,
      parkedReferences: NO_PARKED_REFERENCES,
      inputDrafts: {},
      hasEarlierMessages: false,
      loading: false,
      error: null,
    });
  },
  
  // 加载用户配置
  loadUserConfig: async () => {
    const sequence = sessionSwitchSequence;
    try {
      const config = await apiService.getUserConfig();
      if (sequence !== sessionSwitchSequence || get().currentSessionId) return;
      set({
        ...restoreWorkflowSelection(config.current_workflow, config.lora_prompt, get().availableWorkflows),
        prompt: config.prompt ?? DEFAULT_CONFIG.PROMPT,
        strength: config.strength ?? DEFAULT_CONFIG.STRENGTH,
        count: config.count,
        imagesPerRow: config.images_per_row,
      });
      
      // 加载参考图
      const refImg = await apiService.getReferenceImage();
      if (sequence !== sessionSwitchSequence || get().currentSessionId) return;
      if (refImg.image) {
        set({ referenceImages: [refImg.image] });
      }
      // The active session (or browser method preference when there is none) wins next.
      get().syncInputWorkflow(false);
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
        const workflow = defaults.current_workflow_type || DEFAULT_CONFIG.WORKFLOW;
        const parameters: { name: string; default?: unknown }[] =
          defaults.workflow_metadata?.[workflow]?.parameters || [];
        const getParamDefault = (name: string) =>
          parameters.find((p) => p.name === name)?.default;

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
        set(restoreWorkflowSelection(state.currentWorkflow, state.loraPrompt, workflows, defaultWorkflow));
      }

      // Metadata arrives before saved user/session settings; migrate without recording an initial default.
      get().syncInputWorkflow(false);
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
        width: message.params?.width,
        height: message.params?.height,
        use_original_size: message.params?.useOriginalSize,
        workflow_options: message.params?.workflowOptions,
        reference_images: message.params?.referenceImages
          ?? (message.params?.referenceImage
            ? legacyReferenceSlots(message.params.referenceImage, message.params.referenceImage2, message.params.referenceImage3)
            : undefined),
        motion_reference_images: message.params?.motionReferenceImages,
        motion_reference_video: message.params?.motionReferenceVideo,
        motion_prompt: message.params?.motionPrompt ?? undefined,
        prompt_preset: message.params?.promptPreset,
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
    const sequence = sessionSwitchSequence;
    if (isLoggedIn() && !get().currentSessionId) set({ sessionConfigStatus: 'loading', sessionConfigError: null });
    if (!isLoggedIn()) {
      // 游客模式：从 localStorage 加载
      const sessions = loadGuestSessions();
      
     
      
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
          chatHistory: chatHistoryWithoutImages,
          hasEarlierMessages: false,
        });
        
        // 异步恢复图片数据
        restoreSessionImages(currentSessionId, chatHistoryWithoutImages)
          .then(chatHistory => set({ chatHistory }))
          .catch(error => console.error('恢复图片数据失败:', error));
        
        // 加载当前会话的配置
        await get().loadSessionConfig(currentSessionId);
      } else {
        // 没有会话时，仅设置空会话列表，不预创建
        set({ 
          sessions: [],
          currentSessionId: null,
          composerSessionId: null, sessionConfigStatus: 'idle', sessionConfigError: null,
          chatHistory: [],
          hasEarlierMessages: false,
        });
      }
      return;
    }
    
    try {
      const sessions = await apiService.getSessions();
      if (sequence !== sessionSwitchSequence) return;
      set({ sessions });
      
      const state = get();
      // 尝试恢复上次的 currentSessionId
      let restoredSessionId: string | null = null;
      try {
        const userConfig = await apiService.getUserConfig();
        restoredSessionId = userConfig.current_session_id || null;
      } catch (error) {
        console.error('获取用户配置失败:', error);
      }
      if (sequence !== sessionSwitchSequence) return;
      // 链接里的 ?session=（例如 Agent 给的审核链接）优先于上次打开的会话
      const linkedSessionId = consumeSessionLink();
      if (linkedSessionId && sessions.some(s => s.id === linkedSessionId)) restoredSessionId = linkedSessionId;
      
      // 验证恢复的 sessionId 是否存在
      if (restoredSessionId && sessions.some(s => s.id === restoredSessionId)) {
        await state.switchSession(restoredSessionId);
      } else if (sessions.length > 0) {
        // 否则选择最新的会话
        const latestSession = sessions.sort((a, b) => b.updated_at - a.updated_at)[0];
        await state.switchSession(latestSession.id);
      } else {
        set(current => ({ currentSessionId: null, composerSessionId: null, sessionConfigStatus: 'idle', sessionConfigError: null,
          ...(current.currentSessionId ? { prompt: '', referenceImages: [], referenceImageEnd: null,
            motionReferenceImages: [], motionReferenceVideo: null, motionPrompt: null, promptPreset: null, promptPresetChoices: {},
            inputDrafts: {}, parkedReferences: NO_PARKED_REFERENCES, chatHistory: [], hasEarlierMessages: false } : {}),
        }));
        const current = get();
        const category = current.availableWorkflows.find(item => item.key === current.currentWorkflow)?.category;
        const remembered = category ? current.rememberedMethod[category] : undefined;
        if (remembered && current.availableWorkflows.some(item => item.key === remembered && item.category === category)) {
          current.setCurrentWorkflow(remembered);
        }
      }
    } catch (error) {
      console.error('加载会话列表失败:', error);
      if (sequence === sessionSwitchSequence && !get().currentSessionId) {
        set({ composerSessionId: null, sessionConfigStatus: 'error', sessionConfigError: '会话加载失败，请重试' });
      }
    }
  },
  
  // 创建新会话
  createSession: async (title?: string) => {
    const state = get();
    const sequence = ++sessionSwitchSequence;
    const accountEpoch = sessionAccountEpoch;
    sessionConfigLoadSequence += 1;
    const newTitle = title || '新对话';
    const sessionId = `session-${Date.now()}`;
    
    // 保存当前会话的配置（如果存在）
    if (state.currentSessionId) {
      void state.saveSessionConfig(true);
    }
    set({ composerSessionId: null, sessionConfigStatus: 'loading', sessionConfigError: null, sessionConfigSaveError: null });
    
    // 确保工作流列表已加载
    if (state.availableWorkflows.length === 0) {
      await state.loadAvailableWorkflows();
    }
    if (sequence !== sessionSwitchSequence) return get().currentSessionId ?? sessionId;
    
    // 工作流列表加载后，读取当前可用的默认方式及其参数。
    const workflows = get().availableWorkflows;
    const workflow = resolveAvailableWorkflow(DEFAULT_CONFIG.WORKFLOW, workflows);
    const defaultWorkflow = workflows.find(w => w.key === workflow);
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
      is_pinned: false,
      created_at: Date.now(),
      updated_at: Date.now(),
      message_count: 0,
    };
    
    // 更新本地状态
    set((state) => ({
      sessions: [newSession, ...state.sessions],
      currentSessionId: sessionId,
      chatHistory: [], // 清空当前聊天历史
      hasEarlierMessages: false,
    }));
    
    // 为新会话初始化配置（使用默认工作流的默认参数）
    const newSessionConfig = {
      workflow,
      prompt: defaultPrompt,
      loraPrompt: defaultLoraPrompt,
      strength: defaultStrength,
      count: defaultCount,
      imagesPerRow: DEFAULT_CONFIG.IMAGES_PER_ROW,
      width: Number(defaultWorkflow?.parameters.find(parameter => parameter.name === 'width')?.default) || null,
      height: Number(defaultWorkflow?.parameters.find(parameter => parameter.name === 'height')?.default) || null,
      useOriginalSize: true,
      referenceImage: null,
      referenceImages: [] as (string | null)[],
    };
    
    if (isLoggedIn()) {
      // 登录用户：保存到后端
      try {
        // 后端会生成自己的 session_id，这里只传 title
        const response = await apiService.createSession(newTitle);
        const realSessionId = response.session_id;
        if (accountEpoch !== sessionAccountEpoch) return realSessionId;
        
        // 更新为后端返回的真实 session_id（后端已经返回毫秒级时间戳，无需再乘以1000）
        set((state) => ({
          sessions: state.sessions.map(s => 
            s.id === sessionId 
              ? { ...s, id: realSessionId, created_at: response.created_at, updated_at: response.updated_at }
              : s
          ),
          ...(sequence === sessionSwitchSequence ? { currentSessionId: realSessionId } : {}),
        }));
        
        // Only the still-selected creation may change the active session preference.
        if (sequence === sessionSwitchSequence) void apiService.updateUserConfig({ current_session_id: realSessionId })
          .catch(err => console.error('保存当前会话ID失败:', err));
        
        // 保存新会话的配置到后端
        const initialized = await sessionConfigSaves.save(realSessionId, {
          workflow: newSessionConfig.workflow,
          prompt: newSessionConfig.prompt,
          lora_prompt: newSessionConfig.loraPrompt,
          strength: newSessionConfig.strength,
          count: newSessionConfig.count,
          images_per_row: newSessionConfig.imagesPerRow,
          width: newSessionConfig.width, height: newSessionConfig.height, use_original_size: true,
          reference_images: [],
        }, true);
        if (sequence !== sessionSwitchSequence || get().currentSessionId !== realSessionId) return realSessionId;
        
        // 立即应用后端默认配置
        set({
          composerSessionId: realSessionId, sessionConfigStatus: 'ready', sessionConfigError: null,
          sessionConfigSaveError: initialized ? null : '输入内容保存失败，请重试',
          currentWorkflow: newSessionConfig.workflow,
          prompt: newSessionConfig.prompt,
          loraPrompt: newSessionConfig.loraPrompt,
          strength: newSessionConfig.strength,
          count: newSessionConfig.count,
          imagesPerRow: newSessionConfig.imagesPerRow,
          width: newSessionConfig.width, height: newSessionConfig.height, useOriginalSize: true,
          referenceImages: [],
          referenceImageEnd: null,
          motionReferenceImages: [],
          motionReferenceVideo: null,
          motionPrompt: null,
          promptPreset: null,
          promptPresetChoices: {},
          workflowSettingsStash: {},
          parkedReferences: NO_PARKED_REFERENCES,
          inputDrafts: {},
          selectOptions: clearFixedSeeds(get().selectOptions, get().availableWorkflows),
        });
        get().syncPromptPreset();

        return realSessionId;
      } catch (error) {
        console.error('创建会话失败:', error);
        if (sequence === sessionSwitchSequence) {
          set(current => ({ sessions: current.sessions.filter(item => item.id !== sessionId),
            currentSessionId: null, composerSessionId: null, sessionConfigStatus: 'idle', sessionConfigError: null,
            error: '创建会话失败，请重试' }));
          if (state.currentSessionId) await get().switchSession(state.currentSessionId);
        }
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
        composerSessionId: sessionId, sessionConfigStatus: 'ready', sessionConfigError: null, sessionConfigSaveError: null,
        currentWorkflow: newSessionConfig.workflow,
        prompt: newSessionConfig.prompt,
        loraPrompt: newSessionConfig.loraPrompt,
        strength: newSessionConfig.strength,
        count: newSessionConfig.count,
        imagesPerRow: newSessionConfig.imagesPerRow,
        width: newSessionConfig.width, height: newSessionConfig.height, useOriginalSize: true,
        referenceImages: [],
        referenceImageEnd: null,
        motionReferenceImages: [],
        motionReferenceVideo: null,
        motionPrompt: null,
        promptPreset: null,
        promptPresetChoices: {},
        workflowSettingsStash: {},
        parkedReferences: NO_PARKED_REFERENCES,
        inputDrafts: {},
        selectOptions: clearFixedSeeds(get().selectOptions, get().availableWorkflows),
      });
      get().syncPromptPreset();

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
        sessionSwitchSequence += 1;
        sessionConfigLoadSequence += 1;
        set({ currentSessionId: null, composerSessionId: null, sessionConfigStatus: 'idle', sessionConfigError: null, sessionConfigSaveError: null,
          prompt: '', referenceImages: [], referenceImageEnd: null, promptPreset: null, promptPresetChoices: {},
          chatHistory: [], hasEarlierMessages: false, motionReferenceImages: [], motionReferenceVideo: null, motionPrompt: null,
          parkedReferences: NO_PARKED_REFERENCES, inputDrafts: {} });
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

    // 清理该会话的滚动位置记录
    clearScrollPosition(sessionId);
  },
  
  // 切换会话
  switchSession: async (sessionId: string) => {
    const state = get();
    const switchSequence = ++sessionSwitchSequence;
    
    void state.saveSessionConfig(true);
    set({ currentSessionId: sessionId, composerSessionId: null, sessionConfigStatus: 'loading',
      sessionConfigError: null, sessionConfigSaveError: null, hasEarlierMessages: false });
    
    // 持久化 currentSessionId（登录用户保存到后端配置，游客保存到 localStorage）
    if (isLoggedIn()) {
      apiService.updateUserConfig({ current_session_id: sessionId })
        .catch(error => console.error('保存当前会话ID失败:', error));
    } else {
      localStorage.setItem('currentSessionId', sessionId);
    }
    
    // 加载该会话的配置
    await state.loadSessionConfig(sessionId);
    if (switchSequence !== sessionSwitchSequence || get().currentSessionId !== sessionId) return;
    
    // 加载该会话的聊天历史
    if (isLoggedIn()) {
      try {
        const response = await apiService.getChatHistory(50, sessionId);
        const messages = response.messages as ApiChatMessage[];
        
        // 转换后端数据为前端格式
        const chatHistory: ChatMessage[] = messages.map((msg: ApiChatMessage) => ({
          id: msg.id,
          session_id: sessionId,
          type: msg.type,
          content: msg.content || '',
          images: msg.images || [],
          mediaSeeds: buildMediaSeeds(msg.images, msg.seeds),
          timestamp: msg.timestamp,
          params: msg.params || undefined,
        }));
        
        if (switchSequence === sessionSwitchSequence && get().currentSessionId === sessionId) {
        set({ chatHistory, hasEarlierMessages: response.has_more === true });
        }
      } catch (error) {
        console.error('加载会话历史失败:', error);
      }
    } else {
      // 游客模式：加载指定会话的历史并从 IndexedDB 恢复图片
      const historyWithoutImages = loadGuestSessionHistory(sessionId);
      
      // 异步恢复图片数据
      restoreSessionImages(sessionId, historyWithoutImages)
        .then(chatHistory => {
          if (switchSequence === sessionSwitchSequence && get().currentSessionId === sessionId) {
            set({ chatHistory, hasEarlierMessages: false });
          }
        })
        .catch(error => {
          console.error('恢复图片数据失败:', error);
          if (switchSequence === sessionSwitchSequence && get().currentSessionId === sessionId) {
            set({ chatHistory: historyWithoutImages, hasEarlierMessages: false });
          }
        });
      
      // 先设置不带图片的数据，避免界面空白
      if (switchSequence === sessionSwitchSequence && get().currentSessionId === sessionId) {
        set({ chatHistory: historyWithoutImages, hasEarlierMessages: false });
      }
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

  setSessionPinned: async (sessionId: string, pinned: boolean) => {
    const previous = get().sessions.find(session => session.id === sessionId)?.is_pinned ?? false;
    set(state => ({
      sessions: state.sessions.map(session =>
        session.id === sessionId ? { ...session, is_pinned: pinned } : session
      ),
    }));

    if (!isLoggedIn()) {
      saveGuestSessions(get().sessions);
      return;
    }

    try {
      await apiService.updateSessionPin(sessionId, pinned);
    } catch (error) {
      set(state => ({
        sessions: state.sessions.map(session =>
          session.id === sessionId ? { ...session, is_pinned: previous } : session
        ),
      }));
      console.error('更新会话置顶状态失败:', error);
    }
  },
  
  // 保存当前会话配置
  saveSessionConfig: (immediate = false) => {
    const state = get();
    if (!state.currentSessionId) return Promise.resolve(true);
    if (state.composerSessionId !== state.currentSessionId || state.sessionConfigStatus !== 'ready') return Promise.resolve(false);
    const sessionId = state.currentSessionId;
    const activeMeta = state.availableWorkflows.find(workflow => workflow.key === state.currentWorkflow);
    const motionPrompt = (() => {
      const snapshot = resolveMotionPrompt(state.motionPrompt, state.chatHistory, motionPromptSource(
        state.referenceImages[0] ?? null, state.motionReferenceImages, state.prompt, state.promptPreset,
        state.motionReferenceVideo, activeMeta?.motion_reference_mode), state.availableWorkflows);
      return snapshot?.prompt.trim() ? snapshot : null;
    })();

    const config = {
      workflow: state.currentWorkflow,
      prompt: state.prompt,
      lora_prompt: state.loraPrompt,
      strength: state.strength,
      count: state.count,
      images_per_row: state.imagesPerRow,
      width: state.width,
      height: state.height,
      use_original_size: state.useOriginalSize,
      reference_images: [...state.referenceImages],
      reference_image_end: state.referenceImageEnd,
      motion_reference_images: [...state.motionReferenceImages],
      motion_reference_video: state.motionReferenceVideo,
      motion_prompt: motionPrompt,
      workflow_options: getWorkflowOptions(activeMeta, state.selectOptions),
      prompt_preset: state.promptPreset,
      prompt_preset_choices: state.promptPresetChoices,
      // 两套输入一起保存；元数据未就绪时不发送，避免把当前输入归错类别
      input_drafts: activeMeta
        ? toApiInputDrafts(state.inputDrafts, inputGroupOf(activeMeta), { ...captureComposer(state), motionPrompt })
        : undefined,
    };
    
    if (isLoggedIn()) return sessionConfigSaves.save(sessionId, config, immediate);
      saveGuestSessionConfig(sessionId, {
        workflow: config.workflow,
        prompt: config.prompt,
        loraPrompt: config.lora_prompt,
        strength: config.strength,
        count: config.count,
        imagesPerRow: config.images_per_row,
        referenceImage: config.reference_images[0] ?? null,
        referenceImages: config.reference_images,
        referenceImageEnd: config.reference_image_end,
        motionReferenceImages: config.motion_reference_images,
        motionReferenceVideo: config.motion_reference_video,
        motionPrompt: config.motion_prompt,
        workflowOptions: config.workflow_options,
        width: config.width,
        height: config.height,
        useOriginalSize: config.use_original_size,
        promptPreset: config.prompt_preset,
        promptPresetChoices: config.prompt_preset_choices,
      });
    return Promise.resolve(true);
  },
  
  // 加载指定会话的配置
  loadSessionConfig: async (sessionId: string) => {
    if (get().currentSessionId !== sessionId) return;
    const sequence = ++sessionConfigLoadSequence;
    set({ composerSessionId: null, sessionConfigStatus: 'loading', sessionConfigError: null, sessionConfigSaveError: null });
    try {
    if (isLoggedIn()) {
      // 登录用户：从后端加载
      try {
        const saved = await sessionConfigSaves.flush(sessionId);
        if (get().currentSessionId !== sessionId || sequence !== sessionConfigLoadSequence) return;
        const config = saved ? await apiService.getSessionConfig(sessionId) : sessionConfigSaves.draft(sessionId);
        if (!config) throw new Error('输入内容加载失败');
        if (get().currentSessionId !== sessionId || sequence !== sessionConfigLoadSequence) return;
        const selection = restoreWorkflowSelection(config.workflow, config.lora_prompt, get().availableWorkflows);
        // 当前这一类以普通字段为准，镜像里只取暂存图；另一类的草稿切换时才恢复。
        const inputDrafts = fromApiInputDrafts(config.input_drafts);
        const activeMeta = get().availableWorkflows.find(item => item.key === selection.currentWorkflow);
        set({
          ...selection,
          composerSessionId: sessionId, sessionConfigStatus: 'ready', sessionConfigError: null,
          sessionConfigSaveError: saved ? null : '输入内容保存失败，已恢复尚未保存的草稿，请重试',
          prompt: config.prompt ?? DEFAULT_CONFIG.PROMPT,
          strength: config.strength ?? DEFAULT_CONFIG.STRENGTH,
          count: config.count ?? DEFAULT_CONFIG.COUNT,
          imagesPerRow: config.images_per_row ?? DEFAULT_CONFIG.IMAGES_PER_ROW,
          referenceImages: config.reference_images
            ?? legacyReferenceSlots(config.reference_image, config.reference_image_2, config.reference_image_3),
          referenceImageEnd: config.reference_image_end || null,
          motionReferenceImages: config.motion_reference_images ?? [],
          motionReferenceVideo: isMotionVideoUrl(config.motion_reference_video) ? config.motion_reference_video : null,
          motionPrompt: config.motion_prompt ?? null,
          width: config.width ?? null,
          height: config.height ?? null,
          useOriginalSize: config.use_original_size ?? true,
          selectOptions: config.workflow_options ?? {},
          promptPreset: config.prompt_preset ?? null,
          promptPresetChoices: restorePromptPresetChoices(config.workflow ?? selection.currentWorkflow, config.prompt_preset, config.prompt_preset_choices),
          workflowSettingsStash: {},
          parkedReferences: (activeMeta && inputDrafts[inputGroupOf(activeMeta)]?.parkedReferences) || NO_PARKED_REFERENCES,
          inputDrafts,
        });
        get().syncInputWorkflow();
      } catch (error) {
        console.error('加载会话配置失败:', error);
        if (get().currentSessionId !== sessionId || sequence !== sessionConfigLoadSequence) return;
        // A failed read is not an empty draft and must never become an autosave.
        set({
          composerSessionId: null, sessionConfigStatus: 'error',
          sessionConfigError: '输入内容加载失败，请重试',
        });
      }
    } else {
      // 游客模式：从 localStorage 加载
      const config = loadGuestSessionConfig(sessionId);
      if (get().currentSessionId !== sessionId || sequence !== sessionConfigLoadSequence) return;
      if (config) {
        set({
          ...restoreWorkflowSelection(config.workflow, config.loraPrompt, get().availableWorkflows),
          composerSessionId: sessionId, sessionConfigStatus: 'ready', sessionConfigError: null,
          prompt: config.prompt ?? DEFAULT_CONFIG.PROMPT,
          strength: config.strength ?? DEFAULT_CONFIG.STRENGTH,
          count: config.count ?? DEFAULT_CONFIG.COUNT,
          imagesPerRow: config.imagesPerRow ?? DEFAULT_CONFIG.IMAGES_PER_ROW,
          referenceImages: config.referenceImages
            ?? legacyReferenceSlots(config.referenceImage, config.referenceImage2, config.referenceImage3),
          referenceImageEnd: config.referenceImageEnd || null,
          motionReferenceImages: config.motionReferenceImages ?? [],
          motionReferenceVideo: isMotionVideoUrl(config.motionReferenceVideo) ? config.motionReferenceVideo : null,
          motionPrompt: config.motionPrompt ?? null,
          width: config.width ?? null,
          height: config.height ?? null,
          useOriginalSize: config.useOriginalSize ?? true,
          selectOptions: config.workflowOptions ?? {},
          promptPreset: config.promptPreset ?? null,
          promptPresetChoices: restorePromptPresetChoices(config.workflow, config.promptPreset, config.promptPresetChoices),
          workflowSettingsStash: {},
          parkedReferences: NO_PARKED_REFERENCES,
          inputDrafts: {},
        });
        get().syncInputWorkflow();
      } else {
        set({
          composerSessionId: sessionId, sessionConfigStatus: 'ready', sessionConfigError: null,
          currentWorkflow: DEFAULT_CONFIG.WORKFLOW, prompt: '', loraPrompt: '',
          promptPreset: null, promptPresetChoices: {}, inputDrafts: {}, parkedReferences: NO_PARKED_REFERENCES,
          referenceImageEnd: null,
          motionReferenceImages: [],
          motionReferenceVideo: null,
          motionPrompt: null,
          referenceImages: [],
        });
      }
    }
    } finally {
      if (sequence === sessionConfigLoadSequence && get().currentSessionId === sessionId && get().sessionConfigStatus === 'ready') get().syncPromptPreset();
    }
  },
}));
