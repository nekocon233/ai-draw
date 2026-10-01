import { lazy, Suspense, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Image, Tag, Button, Popconfirm, message as antMessage } from 'antd';
import {
  DownloadOutlined, PictureOutlined, ReloadOutlined,
  DeleteOutlined, EditOutlined, CheckOutlined, CloseOutlined, PlusOutlined,
  AppstoreOutlined, ArrowDownOutlined,
} from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import { useShallow } from 'zustand/react/shallow';
import { getScrollPosition, setScrollPosition, type StoredScrollPosition } from '../utils/scrollPosition';
import { formatLoraPromptForDisplay } from '../utils/loraOptions';
import { compactImageReferences, getImageMentionError, getPresetBlocker, supportsImageMentions } from '../utils/imageMentions';
import type { MotionPromptSnapshot, PromptPreset } from '../types/api';
import ImageMentionInput from './ImageMentionInput';
import PromptPresetTag from './PromptPresetTag';
import MotionReferenceImages from './MotionReferenceImages';
import MotionPromptPanel from './MotionPromptPanel';
import { motionPromptSource } from '../utils/motionPrompt';
import { getMotionReferenceError } from '../utils/motionReferences';
import { isVideoUrl } from '../utils/media';
import { getFixedSeed, getSeedParameter } from '../utils/generationSeed';
import { buildNavigatorRounds, loadUntilFound } from '../utils/roundNavigator';
import { useSessionOutline } from '../hooks/useSessionOutline';
import RoundNavigator from './RoundNavigator';
import './ResultGrid.css';

const loadFrameEditors = () => import('./FrameExtractionModal');
const FrameExtractionModal = lazy(loadFrameEditors);
const ImageEditorModal = lazy(() => loadFrameEditors().then(module => ({ default: module.ImageEditorModal })));

type EditReferenceSlot = 'img1' | 'img2' | 'img3' | 'imgEnd';
type EditReferences = Partial<Record<EditReferenceSlot, string | null>>;

// 跳转落点离结果区顶部的最小距离，避开顶部状态栏和手机菜单按钮
const NAV_TARGET_MIN_OFFSET = 56;

const nextFrames = () => new Promise<void>(resolve => {
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
});

// 导航条跳转后给目标轮次一个短暂的描边提示
function flashRound(element: HTMLElement) {
  if (element.classList.contains('is-nav-target')) return;
  const onEnd = (event: AnimationEvent) => {
    if (event.animationName !== 'round-nav-flash') return;
    element.classList.remove('is-nav-target');
    element.removeEventListener('animationend', onEnd);
  };
  element.addEventListener('animationend', onEnd);
  element.classList.add('is-nav-target');
}

function normalizeEditReferences(content: string, images: EditReferences, mentionsEnabled: boolean) {
  const compact = compactImageReferences(content, [images.img1, images.img2, images.img3]);
  return {
    content: mentionsEnabled ? compact.prompt : content,
    images: { ...images, img1: compact.images[0] ?? null, img2: compact.images[1] ?? null, img3: compact.images[2] ?? null },
  };
}

export default function ResultGrid() {
  const { chatHistory, currentSessionId, currentWorkflow, availableWorkflows, isGenerating, currentGeneratingMessageId, hasEarlierMessages, isLoadingEarlierMessages, loadEarlierMessages, deleteChatMessage, editAndRegenerateMessage, appendChatMedia, scrollToLatestRequest } = useAppStore(useShallow(state => ({
    chatHistory: state.chatHistory,
    currentSessionId: state.currentSessionId,
    currentWorkflow: state.currentWorkflow,
    availableWorkflows: state.availableWorkflows,
    isGenerating: state.isGenerating,
    currentGeneratingMessageId: state.currentGeneratingMessageId,
    hasEarlierMessages: state.hasEarlierMessages,
    isLoadingEarlierMessages: state.isLoadingEarlierMessages,
    loadEarlierMessages: state.loadEarlierMessages,
    deleteChatMessage: state.deleteChatMessage,
    editAndRegenerateMessage: state.editAndRegenerateMessage,
    appendChatMedia: state.appendChatMedia,
    scrollToLatestRequest: state.scrollToLatestRequest,
  })));
  const activeWorkflow = availableWorkflows.find(item => item.key === currentWorkflow);
  const acceptsReferenceImage = activeWorkflow?.requires_image || activeWorkflow?.requires_end_image || activeWorkflow?.supports_optional_keyframes || activeWorkflow?.supports_multi_image;
  const formatLora = (loraPrompt: string, workflow?: string) =>
    formatLoraPromptForDisplay(loraPrompt, availableWorkflows.find(item => item.key === workflow)?.lora_labels);
  const isWorkflowAvailable = (workflow?: string) => availableWorkflows.some(item => item.key === workflow);
  const fixedSeedOf = (params?: { workflow: string; workflowOptions?: Record<string, unknown> }) =>
    params ? getFixedSeed(availableWorkflows.find(item => item.key === params.workflow), params.workflowOptions) : null;
  // 助手消息的种子属于上一条用户消息所选的工作流
  const roundWorkflows = useMemo(() => {
    const workflows = new Map<string, string>();
    let workflow: string | undefined;
    for (const message of chatHistory) {
      if (message.type === 'user') workflow = message.params?.workflow;
      else if (workflow) workflows.set(message.id, workflow);
    }
    return workflows;
  }, [chatHistory]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevSessionId = useRef<string | null>(null);
  const prevHistoryLength = useRef<number>(0);
  // 记录上次见到的 chatHistory 引用，区分「历史真正刷新」与「仅 currentSessionId 变化」
  const lastHistoryRef = useRef<typeof chatHistory | null>(null);
  // 标记正在等待某会话的历史加载完成（switchSession 先改 currentSessionId，后改 chatHistory）
  const pendingSessionRef = useRef<string | null>(null);
  // 标记正在进行程序化的位置恢复；期间忽略滚动保存，用户交互可中止
  const isRestoringRef = useRef(false);
  // 恢复「代数」：每次启动新恢复自增，旧的恢复循环发现代数不匹配即自行退出
  // （避免快速切换会话时多个恢复循环同时写 scrollTop 互相打架）
  const restoreGenRef = useRef(0);
  // 最近一次用户滚动位置。刷新/关闭页面时 React cleanup 不可靠，需靠 pagehide 强制落盘。
  const latestScrollSessionRef = useRef<string | null>(null);
  const latestScrollPositionRef = useRef<StoredScrollPosition | null>(null);
  const previousMediaCountRef = useRef(0);
  const mediaBaselinePendingRef = useRef(true);
  const isNearBottomRef = useRef(true);
  // 挂载前的发送已由会话首次加载滚到底，只响应挂载后的新发送
  const handledScrollRequestRef = useRef(scrollToLatestRequest);
  // 导航代数：导航条跳转和用户发送各加一。已排好的被动跟随、会话位置恢复发现代数变了就放弃，不覆盖用户的选择
  const navTokenRef = useRef(0);
  const historyMatchesCurrentSession = Boolean(
    currentSessionId
    && chatHistory.length > 0
    && chatHistory.every(message => message.session_id === currentSessionId),
  );

  // 找到真正负责滚动的容器：从锚点向上找第一个「实际可滚动」的祖先
  // （overflow-y 为 auto/scroll 且 scrollHeight > clientHeight）；找不到时回退到 .results-area。
  // 这样无论 .chat-messages 还是 .results-area 实际滚动，保存/恢复都指向同一元素。
  const getScrollContainer = useCallback((): HTMLElement | null => {
    let el = messagesEndRef.current?.parentElement ?? null;
    while (el) {
      const ov = window.getComputedStyle(el).overflowY;
      if ((ov === 'auto' || ov === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
        return el;
      }
      el = el.parentElement;
    }
    return messagesEndRef.current?.closest<HTMLElement>('.results-area') ?? null;
  }, []);

  // 滚动到底部
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    restoreGenRef.current += 1; // 取消任何在途的恢复循环
    isRestoringRef.current = false;
    isNearBottomRef.current = true;
    const container = getScrollContainer();
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior });
    }
  }, [getScrollContainer]);

  const handleLoadEarlier = useCallback(async () => {
    const container = getScrollContainer();
    const previousHeight = container?.scrollHeight ?? 0;
    const previousTop = container?.scrollTop ?? 0;
    await loadEarlierMessages();
    window.requestAnimationFrame(() => {
      const current = getScrollContainer();
      if (current) current.scrollTop = previousTop + current.scrollHeight - previousHeight;
    });
  }, [getScrollContainer, loadEarlierMessages]);

  const getVisibleAnchor = useCallback((container: HTMLElement): StoredScrollPosition => {
    const containerTop = container.getBoundingClientRect().top;
    const messages = Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]'));
    const firstVisible = messages.find(el => el.getBoundingClientRect().bottom > containerTop + 1);
    if (!firstVisible) {
      return { scrollTop: container.scrollTop, savedAt: Date.now() };
    }
    return {
      scrollTop: container.scrollTop,
      messageId: firstVisible.dataset.messageId,
      offset: firstVisible.getBoundingClientRect().top - containerTop,
      savedAt: Date.now(),
    };
  }, []);

  const findMessageElement = useCallback((container: HTMLElement, messageId?: string) => {
    if (!messageId) return null;
    return Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]'))
      .find(el => el.dataset.messageId === messageId) ?? null;
  }, []);

  // 按「顶部可见消息 + 相对偏移」恢复。相比纯 scrollTop，它能抵抗刷新后图片逐步加载造成的重排。
  // maxAttempts：100ms 间隔的最多校正次数，默认约 10 秒
  const restoreScrollPosition = useCallback((position: StoredScrollPosition, { maxAttempts = 100 }: { maxAttempts?: number } = {}) => {
    const container = getScrollContainer();
    if (!container) return;
    const gen = ++restoreGenRef.current;
    isRestoringRef.current = true;
    let lastSetTop = -1; // 上次我们设置后的实际 scrollTop，用于检测外部滚动
    let lastHeight = -1;
    let heightStable = 0;
    let attempts = 0;
    const tick = () => {
      if (gen !== restoreGenRef.current) return; // 被更新的恢复取代
      if (!isRestoringRef.current) return;
      const el = getScrollContainer() || container;
      // 自上次设置后 scrollTop 被外部（滚轮/拖拽/触摸）改变 → 中止恢复
      if (lastSetTop >= 0 && el.scrollTop !== lastSetTop) {
        isRestoringRef.current = false;
        return;
      }
      const anchor = findMessageElement(el, position.messageId);
      if (anchor) {
        const offset = position.offset ?? 0;
        const currentOffset = anchor.getBoundingClientRect().top - el.getBoundingClientRect().top;
        el.scrollTop += currentOffset - offset;
      } else {
        el.scrollTop = position.scrollTop;
      }
      lastSetTop = el.scrollTop; // 实际值（可能被 clamp）
      const sh = el.scrollHeight;
      heightStable = sh === lastHeight ? heightStable + 1 : 0;
      lastHeight = sh;
      attempts += 1;
      const anchorAfter = findMessageElement(el, position.messageId);
      // 正值表示还需要往下滚
      const remaining = anchorAfter
        ? (anchorAfter.getBoundingClientRect().top - el.getBoundingClientRect().top) - (position.offset ?? 0)
        : position.scrollTop - lastSetTop;
      // 已经滚到顶或到底、无法再靠近时也算到位，例如跳到最后几轮
      const atEdge = (remaining > 0 && lastSetTop >= el.scrollHeight - el.clientHeight - 1) || (remaining < 0 && lastSetTop <= 0);
      const reached = Math.abs(remaining) < 1 || atEdge;
      const hasPendingImagesBeforeAnchor = Array.from(el.querySelectorAll<HTMLImageElement>('img')).some(image => {
        if (image.complete) return false;
        if (!anchorAfter) return true;
        const message = image.closest<HTMLElement>('[data-message-id]');
        return Boolean(
          message
          && message !== anchorAfter
          && (message.compareDocumentPosition(anchorAfter) & Node.DOCUMENT_POSITION_FOLLOWING),
        );
      });
      if ((reached && heightStable >= 3 && !hasPendingImagesBeforeAnchor) || attempts >= maxAttempts) {
        isRestoringRef.current = false;
        return;
      }
      window.setTimeout(tick, 100);
    };
    requestAnimationFrame(tick);
  }, [findMessageElement, getScrollContainer]);

  // 同时记下会话与位置：只更新位置时，flush 可能把它存进别的会话
  const rememberScrollPosition = useCallback((sessionId: string, position: StoredScrollPosition) => {
    latestScrollSessionRef.current = sessionId;
    latestScrollPositionRef.current = position;
    setScrollPosition(sessionId, position);
  }, []);

  // ---- 对话轮次导航 ----
  const { rounds: sessionOutline, forget: forgetOutlineRound, refresh: refreshOutline } = useSessionOutline(
    currentSessionId,
    hasEarlierMessages && historyMatchesCurrentSession,
  );
  const navigatorRounds = useMemo(
    () => (historyMatchesCurrentSession
      ? buildNavigatorRounds(chatHistory, hasEarlierMessages ? sessionOutline : null, currentGeneratingMessageId)
      : []),
    [chatHistory, currentGeneratingMessageId, hasEarlierMessages, historyMatchesCurrentSession, sessionOutline],
  );
  const workflowLabels = useMemo(
    () => Object.fromEntries(availableWorkflows.map(item => [item.key, item.label])),
    [availableWorkflows],
  );

  const jumpToRound = useCallback(async (roundId: string) => {
    const sessionId = useAppStore.getState().currentSessionId;
    if (!sessionId) return;
    const navToken = ++navTokenRef.current;
    const gen = ++restoreGenRef.current; // 取消在途的位置恢复，由本次跳转接管
    isRestoringRef.current = true; // 期间暂停位置保存、贴底和被动跟随
    isNearBottomRef.current = false;
    const alive = () => navTokenRef.current === navToken
      && restoreGenRef.current === gen
      && isRestoringRef.current
      && useAppStore.getState().currentSessionId === sessionId;
    const locate = () => {
      const container = getScrollContainer();
      return container ? findMessageElement(container, roundId) : null;
    };
    let handedOff = false;
    try {
      if (!locate()) {
        // 先回到顶部：这里正好显示「加载更早记录」的进度，往前插入内容时视口也不会乱跳
        const container = getScrollContainer();
        if (container) container.scrollTop = 0;
        const result = await loadUntilFound({
          find: () => locate() !== null,
          hasMore: () => useAppStore.getState().hasEarlierMessages,
          load: () => useAppStore.getState().loadEarlierMessages(),
          alive,
          settle: nextFrames,
        });
        if (result === 'cancelled') return;
        if (result === 'error') {
          antMessage.error('加载更早记录失败，请重试');
          return;
        }
        if (result === 'missing') {
          const latest = await refreshOutline();
          if (alive()) {
            const stillExists = latest === null || latest.some(round => round.id === roundId);
            antMessage.warning(stillExists ? '没能定位到这一轮，请刷新页面后重试' : '这一轮对话已不存在');
          }
          return;
        }
      }
      const container = getScrollContainer();
      const target = locate();
      if (!container || !target) return;
      const offset = Math.max(parseFloat(window.getComputedStyle(container).paddingTop) || 0, NAV_TARGET_MIN_OFFSET);
      const position: StoredScrollPosition = {
        scrollTop: Math.max(0, container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - offset),
        messageId: roundId,
        offset,
        savedAt: Date.now(),
      };
      rememberScrollPosition(sessionId, position);
      handedOff = true;
      restoreScrollPosition(position, { maxAttempts: 30 });
      flashRound(target);
    } catch (error) {
      console.error('跳转到对话轮次失败:', error);
    } finally {
      if (!handedOff && restoreGenRef.current === gen) isRestoringRef.current = false;
    }
  }, [findMessageElement, getScrollContainer, refreshOutline, rememberScrollPosition, restoreScrollPosition]);

  // ---- 编辑状态 ----
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ content: string; images: EditReferences }>({ content: '', images: {} });
  const { content: editContent, images: editRefImages } = editDraft;
  const editVersionRef = useRef(0);
  const editWorkflow = chatHistory.find(item => item.id === editingMsgId)?.params?.workflow;
  const editWorkflowMeta = availableWorkflows.find(item => item.key === editWorkflow);
  const editMentionsEnabled = supportsImageMentions(editWorkflowMeta);
  const [editPreset, setEditPreset] = useState<PromptPreset | null>(null);
  const [editMotionImages, setEditMotionImages] = useState<string[]>([]);
  const [editMotionUploading, setEditMotionUploading] = useState(false);
  const [editMotionPrompt, setEditMotionPrompt] = useState<MotionPromptSnapshot | null>(null);
  const [editMotionPreviewing, setEditMotionPreviewing] = useState(false);
  const editPresetIssue = editPreset
    ? getPresetBlocker(editPreset, editWorkflowMeta, [editRefImages.img1, editRefImages.img2, editRefImages.img3], editRefImages.imgEnd, editMotionImages) : null;
  const [frameEditor, setFrameEditor] = useState<{
    videoUrl: string;
    messageId: string;
  } | null>(null);
  const [imageEditor, setImageEditor] = useState<{ messageId: string; imageUrl: string } | null>(null);
  const [stripImageKeys, setStripImageKeys] = useState<Set<string>>(new Set());
  const [failedMediaKeys, setFailedMediaKeys] = useState<Set<string>>(new Set());
  const [mediaRetryVersions, setMediaRetryVersions] = useState<Record<string, number>>({});
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [scrollButtonPosition, setScrollButtonPosition] = useState({ left: 0, bottom: 0 });
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const activeRefSlot = useRef<EditReferenceSlot>('img1');


  const startEdit = useCallback((message: { id: string; content: string; params?: { workflow?: string; promptEnd?: string; referenceImage?: string; referenceImage2?: string; referenceImage3?: string; referenceImageEnd?: string; promptPreset?: PromptPreset; motionReferenceImages?: string[]; motionPrompt?: MotionPromptSnapshot | null } }) => {
    editVersionRef.current++;
    setEditingMsgId(message.id);
    setEditPreset(message.params?.promptPreset ?? null);
    setEditMotionImages([...(message.params?.motionReferenceImages ?? [])]);
    setEditMotionPrompt(message.params?.motionPrompt ?? null);
    setEditDraft(normalizeEditReferences(message.content, {
      img1: message.params?.referenceImage ?? null,
      img2: message.params?.referenceImage2 ?? null,
      img3: message.params?.referenceImage3 ?? null,
      imgEnd: message.params?.referenceImageEnd ?? null,
    }, supportsImageMentions(availableWorkflows.find(item => item.key === message.params?.workflow))));
  }, [availableWorkflows]);

  const cancelEdit = useCallback(() => { editVersionRef.current++; setEditingMsgId(null); }, []);

  const updateEditReference = useCallback((slot: EditReferenceSlot, image: string | null) => {
    setEditMotionPrompt(null);
    setEditDraft(previous => {
      const images = { ...previous.images, [slot]: image };
      return slot === 'imgEnd' ? { ...previous, images } : normalizeEditReferences(previous.content, images, editMentionsEnabled);
    });
  }, [editMentionsEnabled]);

  const confirmEdit = useCallback(async (msgId: string) => {
    if (editMotionPreviewing) { antMessage.warning('请等待动作提示词分析完成'); return; }
    if (editMotionUploading) { antMessage.warning('请等待动作图上传完成'); return; }
    if (editWorkflowMeta?.supports_motion_reference) {
      const issue = getMotionReferenceError(editRefImages.img1, editMotionImages);
      if (issue) { antMessage.warning(issue); return; }
    }
    if (editPreset && editPresetIssue) { antMessage.warning(`预设「${editPreset.title}」：${editPresetIssue}`); return; }
    const error = editMentionsEnabled ? getImageMentionError(editContent, [editRefImages.img1, editRefImages.img2, editRefImages.img3]) : null;
    if (error) { antMessage.warning(error); return; }
    // 立即退出编辑模式，不等待生成完成
    const content = editContent;
    const refImages = { ...editRefImages };
    editVersionRef.current++;
    setEditingMsgId(null);
    await editAndRegenerateMessage(msgId, content, {
      referenceImage: refImages.img1,
      referenceImage2: refImages.img2,
      referenceImage3: refImages.img3,
      referenceImageEnd: refImages.imgEnd,
      motionReferenceImages: editWorkflowMeta?.supports_motion_reference ? [...editMotionImages] : undefined,
      motionPrompt: editWorkflowMeta?.supports_motion_reference ? editMotionPrompt : undefined,
    }, editPreset);
  }, [editAndRegenerateMessage, editContent, editRefImages, editMentionsEnabled, editPreset, editPresetIssue, editMotionImages, editWorkflowMeta, editMotionUploading, editMotionPrompt, editMotionPreviewing]);

  const handleEditFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const slot = activeRefSlot.current;
    const version = editVersionRef.current;
    const sessionId = useAppStore.getState().currentSessionId;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (version !== editVersionRef.current || sessionId !== useAppStore.getState().currentSessionId) return;
      const base64 = ev.target?.result as string;
      updateEditReference(slot, base64);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, [updateEditReference]);

  const getEditReferenceSlots = (params?: {
    workflow: string;
    referenceImage?: string;
    referenceImage2?: string;
    referenceImage3?: string;
    referenceImageEnd?: string;
  }): Array<{ key: EditReferenceSlot; label: string }> => {
    if (!params) return [];
    const workflow = availableWorkflows.find(item => item.key === params.workflow);
    const supportsEnd = Boolean(workflow?.requires_end_image || workflow?.supports_optional_keyframes);
    const supportsMulti = Boolean(workflow?.supports_multi_image);
    const supportsSketch = Boolean(workflow?.image_workflow);
    const hasReference = Boolean(
      params.referenceImage || params.referenceImage2 || params.referenceImage3 || params.referenceImageEnd,
    );
    if (!hasReference && !workflow?.requires_image && !supportsEnd && !supportsMulti && !supportsSketch) return [];

    const slots: Array<{ key: EditReferenceSlot; label: string }> = [
      { key: 'img1', label: workflow?.supports_motion_reference ? '角色外观图' : supportsEnd ? '首帧' : '参考图 1' },
    ];
    if (supportsMulti || params.referenceImage2 || params.referenceImage3) {
      slots.push(
        { key: 'img2', label: '参考图 2' },
        { key: 'img3', label: '参考图 3' },
      );
    }
    if (supportsEnd || params.referenceImageEnd) slots.push({ key: 'imgEnd', label: '尾帧' });
    return slots;
  };

  // 跟踪会话切换：仅记录 pending，真正的滚动等新会话历史加载后处理
  useEffect(() => {
    if (currentSessionId && currentSessionId !== prevSessionId.current) {
      prevSessionId.current = currentSessionId;
      pendingSessionRef.current = currentSessionId;
      mediaBaselinePendingRef.current = true;
    }
  }, [currentSessionId]);

  // 历史更新：区分「会话首次加载 → 恢复上次位置」与「当前会话新增消息 → 滚到底」
  useEffect(() => {
    const historyRefChanged = lastHistoryRef.current !== chatHistory;
    lastHistoryRef.current = chatHistory;
    // 仅 currentSessionId 变化、历史尚未刷新 → 跳过，等新会话历史 set 后再处理
    if (!historyRefChanged) return;

    if (chatHistory.length === 0) {
      prevHistoryLength.current = 0;
      return;
    }

    const isPendingSession = !!pendingSessionRef.current && pendingSessionRef.current === currentSessionId;

    if (isPendingSession) {
      // 切换到新会话后历史首次加载完成 → 恢复上次位置（无记录则瞬时到底）
      pendingSessionRef.current = null;
      prevHistoryLength.current = chatHistory.length;
      const sid = currentSessionId as string;
      const saved = getScrollPosition(sid);
      // 恢复期间用户已经用导航条跳转过，就不再拉回上次位置
      const navToken = navTokenRef.current;
      setTimeout(() => {
        if (navTokenRef.current !== navToken) return;
        if (saved == null) {
          scrollToBottom('auto');
          return;
        }
        isNearBottomRef.current = false;
        void (async () => {
          let pagesLoaded = 0;
          while (saved.messageId && pagesLoaded < 20 && navTokenRef.current === navToken) {
            const container = getScrollContainer();
            if (container && findMessageElement(container, saved.messageId)) break;
            const state = useAppStore.getState();
            if (state.currentSessionId !== sid || !state.hasEarlierMessages) break;
            const result = await state.loadEarlierMessages();
            if (result === 'error' || result === 'stale') break;
            pagesLoaded += 1;
            await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
          }
          if (useAppStore.getState().currentSessionId === sid && navTokenRef.current === navToken) restoreScrollPosition(saved);
        })();
      }, 50);
      return;
    }

    // 当前会话内消息条数变化（发消息 / 生成 / 删除）→ 平滑滚到底
    if (chatHistory.length !== prevHistoryLength.current) {
      prevHistoryLength.current = chatHistory.length;
      if (isNearBottomRef.current) {
        const navToken = navTokenRef.current;
        setTimeout(() => {
          if (navTokenRef.current === navToken && !isRestoringRef.current) scrollToBottom('smooth');
        }, 50);
      }
    }
  }, [chatHistory, currentSessionId, findMessageElement, getScrollContainer, restoreScrollPosition, scrollToBottom]);

  // 媒体替换 loading 占位符时消息数量不变，单独跟踪结果数量并滚动到新结果。
  useEffect(() => {
    const mediaCount = chatHistory.reduce(
      (total, message) => total + (message.images?.filter(image => typeof image === 'string').length ?? 0),
      0,
    );
    const historyMatchesSession = chatHistory.length === 0
      || chatHistory.every(message => message.session_id === currentSessionId);

    if (mediaBaselinePendingRef.current) {
      if (!historyMatchesSession) return;
      mediaBaselinePendingRef.current = false;
      previousMediaCountRef.current = mediaCount;
      return;
    }

    const hasNewMedia = mediaCount > previousMediaCountRef.current;
    previousMediaCountRef.current = mediaCount;
    if (!hasNewMedia || !isNearBottomRef.current) return;

    const sessionAtSchedule = currentSessionId;
    const navToken = navTokenRef.current;
    [50, 250, 700].forEach(delay => window.setTimeout(() => {
      if (prevSessionId.current === sessionAtSchedule && navTokenRef.current === navToken) scrollToBottom('smooth');
    }, delay));
  }, [chatHistory, currentSessionId, scrollToBottom]);

  // 用户自己发送一轮后一律滚到底部（即使之前往上翻过）；参考图缩略图和占位卡片渲染后再跟随两次
  useEffect(() => {
    if (scrollToLatestRequest === handledScrollRequestRef.current) return;
    handledScrollRequestRef.current = scrollToLatestRequest;
    const sessionAtSchedule = useAppStore.getState().currentSessionId;
    // 发送优先于之前的导航条跳转；发送后再跳转则以跳转为准
    const navToken = ++navTokenRef.current;
    const timers = [50, 300, 800].map(delay => window.setTimeout(() => {
      if (useAppStore.getState().currentSessionId === sessionAtSchedule && navTokenRef.current === navToken) scrollToBottom('smooth');
    }, delay));
    return () => timers.forEach(timer => window.clearTimeout(timer));
  }, [scrollToLatestRequest, scrollToBottom]);

  useEffect(() => {
    const container = getScrollContainer();
    if (!container) return;

    const updateScrollButton = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      isNearBottomRef.current = distanceFromBottom <= 120;
      const rect = container.getBoundingClientRect();
      setShowScrollToBottom(distanceFromBottom > 120);
      const left = rect.left + rect.width / 2;
      const bottom = window.innerHeight - rect.bottom + 14;
      // 位置不变时保持同一对象，避免每次滚动都重渲染整个列表
      setScrollButtonPosition(previous => (previous.left === left && previous.bottom === bottom ? previous : { left, bottom }));
    };

    // 输入框变高会压缩结果区：原本停在底部时保持贴底，最新内容不被挡住，之后的新结果也照常自动滚动
    let observedHeight: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      const height = container.clientHeight;
      if (observedHeight !== null && height !== observedHeight && isNearBottomRef.current && !isRestoringRef.current) {
        container.scrollTop = container.scrollHeight;
      }
      observedHeight = height;
      updateScrollButton();
    });
    resizeObserver.observe(container);
    container.addEventListener('scroll', updateScrollButton, { passive: true });
    window.addEventListener('resize', updateScrollButton);
    updateScrollButton();

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('scroll', updateScrollButton);
      window.removeEventListener('resize', updateScrollButton);
    };
  }, [chatHistory.length, getScrollContainer]);

  // 保存滚动位置：用户滚动时（debounce）写入 localStorage；切换会话前 flush 落盘
  useEffect(() => {
    const container = getScrollContainer();
    if (!container || !currentSessionId || !historyMatchesCurrentSession) return;
    const sid = currentSessionId;
    let timer: number | undefined;
    const captureLatest = () => {
      if (isRestoringRef.current) return null;
      const position = getVisibleAnchor(container);
      latestScrollSessionRef.current = sid;
      latestScrollPositionRef.current = position;
      return position;
    };
    const saveNow = (position = latestScrollPositionRef.current) => {
      if (latestScrollSessionRef.current === sid && position) setScrollPosition(sid, position);
    };
    const flush = () => {
      window.clearTimeout(timer);
      const position = captureLatest() ?? latestScrollPositionRef.current;
      saveNow(position);
    };
    const onScroll = () => {
      if (isRestoringRef.current) return;
      const position = captureLatest();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => saveNow(position), 50);
    };
    const cancelRestore = (event: Event) => {
      // 在导航条上按方向键预览不算用户滚动，不能打断跳转后的位置校正
      if (event.target instanceof Element && event.target.closest('.round-nav, .round-nav-preview')) return;
      isRestoringRef.current = false;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    container.addEventListener('wheel', cancelRestore, { passive: true });
    container.addEventListener('touchmove', cancelRestore, { passive: true });
    container.addEventListener('keydown', cancelRestore);
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      flush(); // 离开会话前确保最后一次位置落盘
      container.removeEventListener('scroll', onScroll);
      container.removeEventListener('wheel', cancelRestore);
      container.removeEventListener('touchmove', cancelRestore);
      container.removeEventListener('keydown', cancelRestore);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [getScrollContainer, getVisibleAnchor, currentSessionId, historyMatchesCurrentSession]);

  useEffect(() => {
    const candidates: { key: string; url: string }[] = [];
    chatHistory.forEach(message => {
      if (message.type !== 'assistant' || !message.images) return;
      message.images.forEach((image, imgIndex) => {
        if (typeof image !== 'string' || isVideoUrl(image) || !image.includes('/uploads/spritesheet/')) return;
        candidates.push({ key: `${message.id}:${imgIndex}`, url: image });
      });
    });

    const candidateKeys = new Set(candidates.map(item => item.key));
    setStripImageKeys(prev => {
      const next = new Set<string>();
      prev.forEach(key => {
        if (candidateKeys.has(key)) next.add(key);
      });
      if (next.size === prev.size && [...next].every(key => prev.has(key))) return prev;
      return next;
    });

    let cancelled = false;
    candidates.forEach(({ key, url }) => {
      const img = new window.Image();
      img.onload = () => {
        if (cancelled) return;
        const isStrip = img.naturalWidth / Math.max(1, img.naturalHeight) >= 3;
        setStripImageKeys(prev => {
          if (prev.has(key) === isStrip) return prev;
          const next = new Set(prev);
          if (isStrip) {
            next.add(key);
          } else {
            next.delete(key);
          }
          return next;
        });
      };
      img.onerror = () => {
        if (cancelled) return;
        setStripImageKeys(prev => {
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      };
      img.src = url;
    });

    return () => {
      cancelled = true;
    };
  }, [chatHistory]);

  const downloadImage = (imageUrl: string, index: number) => {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `ai-draw-${Date.now()}-${index + 1}.${isVideoUrl(imageUrl) ? 'mp4' : 'png'}`;
    link.click();
  };

  const retryMedia = (mediaKey: string) => {
    setFailedMediaKeys(previous => {
      const next = new Set(previous);
      next.delete(mediaKey);
      return next;
    });
    setMediaRetryVersions(previous => ({
      ...previous,
      [mediaKey]: (previous[mediaKey] ?? 0) + 1,
    }));
  };

  const setAsReference = (imageUrl: string) => {
    const state = useAppStore.getState();
    const workflow = state.availableWorkflows.find(item => item.key === state.currentWorkflow);
    if (!state.referenceImage) state.setReferenceImage(imageUrl);
    else if ((workflow?.requires_end_image || workflow?.supports_optional_keyframes) && !state.referenceImageEnd) state.setReferenceImageEnd(imageUrl);
    else if (workflow?.supports_multi_image && !state.referenceImage2) state.setReferenceImage2(imageUrl);
    else if (workflow?.supports_multi_image && !state.referenceImage3) state.setReferenceImage3(imageUrl);
    else state.setReferenceImage(imageUrl);
    antMessage.success('已添加到当前输入的参考图');
  };

  const reuseSeed = (workflow: string | undefined, seed: number) => {
    const state = useAppStore.getState();
    const source = state.availableWorkflows.find(item => item.key === workflow);
    const parameter = getSeedParameter(source);
    if (!parameter) {
      antMessage.warning('此生成方式已停用，无法复用种子');
      return;
    }
    state.setSelectOption(parameter.name, seed);
    const active = getSeedParameter(state.availableWorkflows.find(item => item.key === state.currentWorkflow));
    antMessage.success(active?.name === parameter.name
      ? `已固定种子 ${seed}，可在生成设置中改回随机`
      : `已为「${source?.category ?? source?.label}」固定种子 ${seed}，切换过去后生效`);
  };

  const openFrameEditor = (messageId: string, videoUrl: string) => {
    setFrameEditor({ messageId, videoUrl });
  };

  const handleFrameExportGenerated = (url: string) => {
    if (!frameEditor) return;
    const msg = useAppStore.getState().chatHistory.find(m => m.id === frameEditor.messageId);
    const idx = msg?.images?.length ?? 0;
    appendChatMedia(frameEditor.messageId, url, idx);
  };

  const handleImageEdited = (url: string) => {
    if (!imageEditor) return;
    const msg = useAppStore.getState().chatHistory.find(m => m.id === imageEditor.messageId);
    const idx = msg?.images?.length ?? 0;
    appendChatMedia(imageEditor.messageId, url, idx);
  };

  if (chatHistory.length === 0) {
    return (
      <div className="result-container">
        <div className="result-empty">
          <PictureOutlined className="result-empty-icon" aria-hidden="true" />
          <span className="result-empty-text">输入提示词开始生成，结果会显示在这里</span>
        </div>
      </div>
    );
  }

  return (
    <div className="result-container">
      {/* 隐藏的文件选择器（编辑模式参考图上传） */}
      <input
        ref={editFileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleEditFileChange}
      />
      <div className="chat-messages">
        {hasEarlierMessages && (
          <div className="load-earlier-messages">
            <Button loading={isLoadingEarlierMessages} onClick={() => void handleLoadEarlier()}>
              加载更早记录
            </Button>
          </div>
        )}
        {chatHistory.map((message) => (
          <div
            key={message.id}
            data-message-id={message.id}
            className={`chat-message ${message.type === 'user' ? 'chat-message-user' : 'chat-message-assistant'}`}
          >
            {message.type === 'user' ? (
              // 用户消息（右侧）
              <div className={`chat-message-content user-message ${editingMsgId === message.id ? 'is-editing' : ''}`}>
                <div className="chat-message-bubble">
                  {editingMsgId === message.id ? (
                    /* ======= 编辑模式 ======= */
                    <div className="chat-message-edit-mode">
                      {/* 参考图编辑区 */}
                      {getEditReferenceSlots(message.params).length > 0 && (
                        <div className="user-reference-images edit-ref-images">
                          {getEditReferenceSlots(message.params).map((slot) => {
                            const src = editRefImages[slot.key];
                            return src ? (
                              <div key={slot.key} className="edit-ref-image-tile">
                                <img src={src} alt={slot.label} className="edit-ref-thumb" />
                                <button
                                  type="button"
                                  className="edit-ref-remove"
                                  onClick={() => updateEditReference(slot.key, null)}
                                  aria-label={`移除${slot.label}`}
                                >
                                  <CloseOutlined />
                                </button>
                                <button
                                  type="button"
                                  className="edit-ref-replace"
                                  onClick={() => { activeRefSlot.current = slot.key; editFileInputRef.current?.click(); }}
                                  aria-label={`更换${slot.label}`}
                                >
                                  <EditOutlined />
                                </button>
                              </div>
                            ) : (
                              <button
                                key={slot.key}
                                type="button"
                                className="edit-ref-add"
                                onClick={() => { activeRefSlot.current = slot.key; editFileInputRef.current?.click(); }}
                                aria-label={`添加${slot.label}`}
                              >
                                <PlusOutlined />
                                <span>{slot.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {editPreset && (
                        <div className="chat-message-preset">
                          <PromptPresetTag preset={editPreset} issue={editPresetIssue} onRemove={() => { setEditPreset(null); setEditMotionPrompt(null); }} />
                        </div>
                      )}

                      {/* 提示词文本编辑 */}
                      {editWorkflowMeta?.supports_motion_reference && <MotionReferenceImages key={`motion-images-${currentSessionId}-${message.id}`}
                        images={editMotionImages} onChange={images => { setEditMotionImages(images); setEditMotionPrompt(null); }} onUploadingChange={setEditMotionUploading}
                        shotMode={editPreset?.motion_reference_mode === 'shot'} />}
                      {editWorkflowMeta?.supports_motion_reference && <MotionPromptPanel key={`motion-prompt-${currentSessionId}-${message.id}`}
                        source={motionPromptSource(editRefImages.img1, editMotionImages, editContent, editPreset)} snapshot={editMotionPrompt}
                        onChange={setEditMotionPrompt} onBusyChange={setEditMotionPreviewing} disabled={editMotionUploading} />}
                      <ImageMentionInput
                        className="edit-content-textarea"
                        value={editContent}
                        onChange={content => { setEditDraft(previous => ({ ...previous, content })); setEditMotionPrompt(null); }}
                        images={[editRefImages.img1, editRefImages.img2, editRefImages.img3]}
                        enabled={editMentionsEnabled}
                        autoSize={{ minRows: 2, maxRows: 8 }}
                        placeholder={editMentionsEnabled ? '输入提示词，输入 @ 引用参考图…' : '输入提示词…'}
                        aria-label="提示词"
                      />

                      {/* 参数标签（只读）+ 操作按钮 */}
                      {message.params && (
                        <div className="chat-message-params">
                          <Tag>{message.params.workflow}</Tag>
                          {message.params.strength != null && <Tag>强度: {message.params.strength}</Tag>}
                          {message.params.count != null && message.params.count > 1 && <Tag>数量: {message.params.count}</Tag>}
                          {message.params.loraPrompt && <Tag>LoRA: {formatLora(message.params.loraPrompt, message.params.workflow)}</Tag>}
                          {fixedSeedOf(message.params) !== null && <Tag>固定种子: {fixedSeedOf(message.params)}</Tag>}
                        </div>
                      )}
                      <div className="edit-actions">
                        <Button
                          type="primary"
                          size="small"
                          icon={<CheckOutlined />}
                          onClick={() => confirmEdit(message.id)}
                          disabled={(!editContent.trim() && !editPreset && !editWorkflowMeta?.supports_motion_reference) || editMotionPreviewing || !isWorkflowAvailable(message.params?.workflow)}
                        >
                          重新生成
                        </Button>
                        <Button size="small" icon={<CloseOutlined />} onClick={cancelEdit}>
                          取消
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* ======= 正常显示模式 ======= */
                    <>
                  {/* 参考图缩略图（可点击预览） */}
                  {(message.params?.referenceImage || message.params?.referenceImage2 || message.params?.referenceImage3 || message.params?.referenceImageEnd) && (
                    <div className="user-reference-images">
                      {([
                        { src: message.params.referenceImage, label: message.params.motionReferenceImages?.length ? '角色外观图' : '参考图 1' },
                        { src: message.params.referenceImage2, label: '参考图 2' },
                        { src: message.params.referenceImage3, label: '参考图 3' },
                        { src: message.params.referenceImageEnd, label: '尾帧参考图' },
                        ...(message.params.motionReferenceImages ?? []).map((src, index) => ({ src, label: `动作 ${index + 1}` })),
                      ] as { src?: string; label: string }[]).filter(item => item.src).map((item) => (
                        <div
                          key={item.label}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/uri-list', item.src!);
                            e.dataTransfer.setData('text/plain', item.src!);
                            e.dataTransfer.effectAllowed = 'copy';
                            const PREVIEW_SIZE = 80;
                            const imgEl = (e.currentTarget as HTMLElement).querySelector('img');
                            const canvas = document.createElement('canvas');
                            canvas.width = PREVIEW_SIZE;
                            canvas.height = PREVIEW_SIZE;
                            canvas.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
                            document.body.appendChild(canvas);
                            if (imgEl) {
                              const ctx = canvas.getContext('2d');
                              const scale = Math.min(PREVIEW_SIZE / imgEl.naturalWidth, PREVIEW_SIZE / imgEl.naturalHeight);
                              const w = imgEl.naturalWidth * scale;
                              const h = imgEl.naturalHeight * scale;
                              ctx?.drawImage(imgEl, (PREVIEW_SIZE - w) / 2, (PREVIEW_SIZE - h) / 2, w, h);
                            }
                            e.dataTransfer.setDragImage(canvas, PREVIEW_SIZE / 2, PREVIEW_SIZE / 2);
                            setTimeout(() => document.body.removeChild(canvas), 0);
                          }}
                          style={{ cursor: 'grab', display: 'inline-block', borderRadius: 6, overflow: 'hidden' }}
                          title={`拖动${item.label}到输入框`}
                        >
                          <Image
                            src={item.src}
                            alt={item.label}
                            width={80}
                            height={80}
                            style={{ objectFit: 'cover', borderRadius: 6, display: 'block' }}
                            preview={{ mask: '预览' }}
                          />
                          <span className="image-reference-caption">{item.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {message.params?.promptPreset && (
                    <div className="chat-message-preset">
                      <PromptPresetTag preset={message.params.promptPreset} />
                    </div>
                  )}
                  {message.content && <div className="chat-message-text">{message.content}</div>}
                  {message.params?.motionPrompt && <details className="motion-prompt-history">
                    <summary>本轮动作提示词 · 保持原画面</summary><div>{message.params.motionPrompt.prompt}</div>
                  </details>}
                  {/* 保留已停用工作流的历史补充描述与参数。 */}
                  {message.params?.promptEnd && (
                    <div className="chat-message-text chat-message-text-end">{message.params.promptEnd}</div>
                  )}
                  {message.params && (
                    <div className="chat-message-params">
                      <Tag>{message.params.workflow}</Tag>
                      {message.params.strength != null && (
                        <Tag>强度: {message.params.strength}</Tag>
                      )}
                      {message.params.count != null && message.params.count > 1 && (
                        <Tag>数量: {message.params.count}</Tag>
                      )}
                      {message.params.loraPrompt && (
                        <Tag>LoRA: {formatLora(message.params.loraPrompt, message.params.workflow)}</Tag>
                      )}
                      {fixedSeedOf(message.params) !== null && (
                        <Tag>固定种子: {fixedSeedOf(message.params)}</Tag>
                      )}
                      {message.params.frameRate != null && (
                        <Tag>帧率: {message.params.frameRate}</Tag>
                      )}
                      {message.params.startFrameCount != null && (
                        <Tag>起始帧: {message.params.startFrameCount}</Tag>
                      )}
                      {message.params.endFrameCount != null && (
                        <Tag>结束帧: {message.params.endFrameCount}</Tag>
                      )}
                    </div>
                  )}
                    </>
                  )}
                </div>
                {editingMsgId !== message.id && (
                  <div className="user-message-actions" aria-label="消息操作">
                    <Button
                      className="edit-round-btn"
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      disabled={isGenerating || !isWorkflowAvailable(message.params?.workflow)}
                      title={!isWorkflowAvailable(message.params?.workflow) ? '此生成方式已停用，请选择可用方式创建新任务。原结果已保留。' : undefined}
                      onClick={() => startEdit(message)}
                      aria-label="编辑并重新生成"
                    />
                    <Popconfirm
                      title="确认删除这轮对话？"
                      onConfirm={() => {
                        forgetOutlineRound(message.id);
                        return deleteChatMessage(message.id);
                      }}
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      placement="topLeft"
                    >
                      <Button
                        className="delete-round-btn"
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        disabled={isGenerating}
                        aria-label="删除本轮对话"
                      />
                    </Popconfirm>
                  </div>
                )}
              </div>
            ) : (
              // AI 回复（左侧）- 图片网格
              <div className="chat-message-content assistant-message">
                {message.images?.length ? (
                  <div
                    className="chat-images-grid"
                    aria-busy={message.id === currentGeneratingMessageId}
                  >
                    {message.images.map((image, imgIndex) => {
                    const seed = typeof image === 'string' ? message.mediaSeeds?.[image] : undefined;
                    return (
                    <div
                      key={imgIndex}
                      className={`chat-image-item ${typeof image === 'string' && stripImageKeys.has(`${message.id}:${imgIndex}`) ? 'is-strip' : ''}`}
                      tabIndex={typeof image === 'string' ? 0 : undefined}
                      aria-label={typeof image === 'string' ? `生成结果 ${imgIndex + 1}${seed === undefined ? '' : `，种子 ${seed}`}` : undefined}
                    >
                      {typeof image === 'string' ? (() => {
                        const mediaKey = `${message.id}:${imgIndex}`;
                        const video = isVideoUrl(image);
                        const stripImage = stripImageKeys.has(mediaKey);
                        const failed = failedMediaKeys.has(mediaKey);
                        const retryVersion = mediaRetryVersions[mediaKey] ?? 0;

                        return (
                          <>
                            <div
                              className={`chat-image-wrapper ${stripImage ? 'chat-image-wrapper-strip' : ''}`}
                              draggable={!video && !failed}
                              onDragStart={(e) => {
                                if (video || failed) return;
                                e.dataTransfer.setData('text/uri-list', image);
                                e.dataTransfer.setData('text/plain', image);
                                e.dataTransfer.effectAllowed = 'copy';

                                const previewSize = 120;
                                const imageElement = (e.currentTarget as HTMLElement).querySelector('img');
                                const canvas = document.createElement('canvas');
                                canvas.width = previewSize;
                                canvas.height = previewSize;
                                canvas.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
                                document.body.appendChild(canvas);
                                if (imageElement) {
                                  const context = canvas.getContext('2d');
                                  const scale = Math.min(previewSize / imageElement.naturalWidth, previewSize / imageElement.naturalHeight);
                                  const width = imageElement.naturalWidth * scale;
                                  const height = imageElement.naturalHeight * scale;
                                  context?.drawImage(imageElement, (previewSize - width) / 2, (previewSize - height) / 2, width, height);
                                }
                                e.dataTransfer.setDragImage(canvas, previewSize / 2, previewSize / 2);
                                setTimeout(() => document.body.removeChild(canvas), 0);
                              }}
                              style={{ cursor: video || failed ? 'default' : 'grab' }}
                            >
                              {failed ? (
                                <div className="media-load-error" role="alert">
                                  <PictureOutlined aria-hidden="true" />
                                  <span>媒体加载失败</span>
                                  <Button type="text" icon={<ReloadOutlined />} onClick={() => retryMedia(mediaKey)}>
                                    重新加载
                                  </Button>
                                </div>
                              ) : video ? (
                                <video
                                  key={`${mediaKey}:${retryVersion}`}
                                  src={image}
                                  controls
                                  preload="metadata"
                                  aria-label={`生成视频 ${imgIndex + 1}`}
                                  onError={() => setFailedMediaKeys(previous => new Set(previous).add(mediaKey))}
                                />
                              ) : (
                                <Image
                                  key={`${mediaKey}:${retryVersion}`}
                                  src={image}
                                  alt={`生成图片 ${imgIndex + 1}`}
                                  className="chat-image"
                                  loading="lazy"
                                  preview={{ mask: '预览' }}
                                  onError={() => setFailedMediaKeys(previous => new Set(previous).add(mediaKey))}
                                />
                              )}
                            </div>
                            {seed !== undefined && (
                              <button
                                type="button"
                                className="chat-image-seed"
                                title="复用此种子"
                                aria-label={`复用种子 ${seed}`}
                                onClick={() => reuseSeed(roundWorkflows.get(message.id), seed)}
                              >
                                <span>种子 {seed}</span>
                              </button>
                            )}
                            <div className="chat-image-overlay" aria-label={`媒体 ${imgIndex + 1} 操作`}>
                              {!video && !failed && acceptsReferenceImage && (
                                <Button type="text" size="small" icon={<PictureOutlined />} onClick={() => setAsReference(image)}>
                                  设为参考
                                </Button>
                              )}
                              <Button
                                type="text"
                                size="small"
                                icon={<DownloadOutlined />}
                                onClick={() => downloadImage(image, imgIndex)}
                              >
                                下载
                              </Button>
                              {video && !failed && (
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<AppstoreOutlined />}
                                  onClick={() => openFrameEditor(message.id, image)}
                                >
                                  帧导出
                                </Button>
                              )}
                              {!video && !failed && image.startsWith('/uploads/') && (
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<EditOutlined />}
                                  onClick={() => setImageEditor({ messageId: message.id, imageUrl: image })}
                                >
                                  编辑
                                </Button>
                              )}
                            </div>
                          </>
                        );
                      })() : (
                        <div className="chat-image-loading" role="status" aria-live="polite">
                          <PictureOutlined className="chat-loading-icon" aria-hidden="true" />
                          <div className="chat-loading-text">正在生成第 {imgIndex + 1} 个结果</div>
                        </div>
                      )}
                    </div>
                    );
                    })}
                  </div>
                ) : (
                  <div
                    className={`assistant-result-state ${message.id === currentGeneratingMessageId ? 'is-loading' : 'is-empty'}`}
                    role={message.id === currentGeneratingMessageId ? 'status' : 'alert'}
                    aria-live="polite"
                  >
                    <PictureOutlined aria-hidden="true" />
                    <div>
                      <strong>{message.id === currentGeneratingMessageId ? '正在准备生成' : '本轮没有返回媒体'}</strong>
                      <span>{message.id === currentGeneratingMessageId ? '结果会在生成后显示在这里' : '可以修改上一条提示词后重新生成'}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {/* 滚动锚点 */}
        <div ref={messagesEndRef} />
      </div>
      <Button
        className={`scroll-to-bottom-button ${showScrollToBottom ? 'is-visible' : ''}`}
        type="default"
        shape="circle"
        icon={<ArrowDownOutlined />}
        style={scrollButtonPosition}
        onClick={() => scrollToBottom('smooth')}
        aria-label="回到最新结果"
        aria-hidden={!showScrollToBottom}
        tabIndex={showScrollToBottom ? 0 : -1}
        title="回到最新结果"
      />
      {navigatorRounds.length > 1 && (
        <RoundNavigator
          rounds={navigatorRounds}
          getContainer={getScrollContainer}
          onJump={jumpToRound}
          workflowLabels={workflowLabels}
        />
      )}
      <Suspense fallback={<div className="lazy-component-loading" role="status">正在加载媒体编辑器...</div>}>
        {frameEditor && (
          <FrameExtractionModal
            open
            videoUrl={frameEditor.videoUrl}
            onClose={() => setFrameEditor(null)}
            onFrameExportGenerated={handleFrameExportGenerated}
          />
        )}
        {imageEditor && (
          <ImageEditorModal
            open
            imageUrl={imageEditor.imageUrl}
            onClose={() => setImageEditor(null)}
            onSaved={handleImageEdited}
          />
        )}
      </Suspense>
    </div>
  );
}
