import { lazy, Suspense, useEffect, useRef, useState, useCallback } from 'react';
import { Image, Tag, Button, Popconfirm, Input, message as antMessage } from 'antd';
import {
  DownloadOutlined, PictureOutlined, ReloadOutlined,
  DeleteOutlined, EditOutlined, CheckOutlined, CloseOutlined, PlusOutlined,
  AppstoreOutlined, ArrowDownOutlined,
} from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import { useShallow } from 'zustand/react/shallow';
import { getScrollPosition, setScrollPosition, type StoredScrollPosition } from '../utils/scrollPosition';
import './ResultGrid.css';

const loadFrameEditors = () => import('./FrameExtractionModal');
const FrameExtractionModal = lazy(loadFrameEditors);
const ImageEditorModal = lazy(() => loadFrameEditors().then(module => ({ default: module.ImageEditorModal })));

export default function ResultGrid() {
  const { chatHistory, currentSessionId, currentWorkflow, availableWorkflows, isGenerating, currentGeneratingMessageId, hasEarlierMessages, isLoadingEarlierMessages, loadEarlierMessages, deleteChatMessage, editAndRegenerateMessage, appendChatMedia } = useAppStore(useShallow(state => ({
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
  })));
  const activeWorkflow = availableWorkflows.find(item => item.key === currentWorkflow);
  const acceptsReferenceImage = activeWorkflow?.requires_image || activeWorkflow?.requires_end_image || activeWorkflow?.supports_multi_image;
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
  const restoreScrollPosition = useCallback((position: StoredScrollPosition) => {
    const container = getScrollContainer();
    if (!container) return;
    const gen = ++restoreGenRef.current;
    isRestoringRef.current = true;
    let lastSetTop = -1; // 上次我们设置后的实际 scrollTop，用于检测外部滚动
    let lastHeight = -1;
    let heightStable = 0;
    let attempts = 0;
    const maxAttempts = 100; // 100ms 间隔，最多校正约 10 秒
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
      const reached = anchorAfter
        ? Math.abs((anchorAfter.getBoundingClientRect().top - el.getBoundingClientRect().top) - (position.offset ?? 0)) < 1
        : Math.abs(lastSetTop - position.scrollTop) < 1;
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

  // ---- 编辑状态 ----
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editPromptEnd, setEditPromptEnd] = useState('');
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
  const [editRefImages, setEditRefImages] = useState<{
    img1?: string | null;
    img2?: string | null;
    img3?: string | null;
  }>({});
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const activeRefSlot = useRef<1 | 2 | 3>(1);


  const startEdit = useCallback((message: { id: string; content: string; params?: { promptEnd?: string; referenceImage?: string; referenceImage2?: string; referenceImage3?: string } }) => {
    setEditingMsgId(message.id);
    setEditContent(message.content);
    setEditPromptEnd(message.params?.promptEnd || '');
    setEditRefImages({
      img1: message.params?.referenceImage ?? null,
      img2: message.params?.referenceImage2 ?? null,
      img3: message.params?.referenceImage3 ?? null,
    });
  }, []);

  const cancelEdit = useCallback(() => setEditingMsgId(null), []);

  const confirmEdit = useCallback(async (msgId: string) => {
    // 立即退出编辑模式，不等待生成完成
    const content = editContent;
    const refImages = { ...editRefImages };
    const promptEnd = editPromptEnd;
    setEditingMsgId(null);
    await editAndRegenerateMessage(msgId, content, {
      referenceImage: refImages.img1,
      referenceImage2: refImages.img2,
      referenceImage3: refImages.img3,
    }, promptEnd);
  }, [editAndRegenerateMessage, editContent, editPromptEnd, editRefImages]);

  const handleEditFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string;
      const slot = activeRefSlot.current;
      setEditRefImages(prev => ({ ...prev, [`img${slot}`]: base64 }));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, []);

  const isVideo = (url: string) => url.startsWith('data:video/') || /\.(mp4|webm)$/i.test(url) || url.includes('/video/');

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
      setTimeout(() => {
        if (saved == null) {
          scrollToBottom('auto');
          return;
        }
        isNearBottomRef.current = false;
        void (async () => {
          let pagesLoaded = 0;
          while (saved.messageId && pagesLoaded < 20) {
            const container = getScrollContainer();
            if (container && findMessageElement(container, saved.messageId)) break;
            const state = useAppStore.getState();
            if (state.currentSessionId !== sid || !state.hasEarlierMessages) break;
            await state.loadEarlierMessages();
            pagesLoaded += 1;
            await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
          }
          if (useAppStore.getState().currentSessionId === sid) restoreScrollPosition(saved);
        })();
      }, 50);
      return;
    }

    // 当前会话内消息条数变化（发消息 / 生成 / 删除）→ 平滑滚到底
    if (chatHistory.length !== prevHistoryLength.current) {
      prevHistoryLength.current = chatHistory.length;
      if (isNearBottomRef.current) setTimeout(() => scrollToBottom('smooth'), 50);
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
    [50, 250, 700].forEach(delay => window.setTimeout(() => {
      if (prevSessionId.current === sessionAtSchedule) scrollToBottom('smooth');
    }, delay));
  }, [chatHistory, currentSessionId, scrollToBottom]);

  useEffect(() => {
    const container = getScrollContainer();
    if (!container) return;

    const updateScrollButton = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      isNearBottomRef.current = distanceFromBottom <= 120;
      const rect = container.getBoundingClientRect();
      setShowScrollToBottom(distanceFromBottom > 120);
      setScrollButtonPosition({
        left: rect.left + rect.width / 2,
        bottom: window.innerHeight - rect.bottom + 14,
      });
    };

    const resizeObserver = new ResizeObserver(updateScrollButton);
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
    const cancelRestore = () => { isRestoringRef.current = false; };
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
        if (typeof image !== 'string' || isVideo(image) || !image.includes('/uploads/spritesheet/')) return;
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
    link.download = `ai-draw-${Date.now()}-${index + 1}.${isVideo(imageUrl) ? 'mp4' : 'png'}`;
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
    else if (workflow?.requires_end_image && !state.referenceImageEnd) state.setReferenceImageEnd(imageUrl);
    else if (workflow?.supports_multi_image && !state.referenceImage2) state.setReferenceImage2(imageUrl);
    else if (workflow?.supports_multi_image && !state.referenceImage3) state.setReferenceImage3(imageUrl);
    else state.setReferenceImage(imageUrl);
    antMessage.success('已添加到当前输入的参考图');
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
                      {(editRefImages.img1 || editRefImages.img2 || editRefImages.img3 ||
                        message.params?.referenceImage || message.params?.referenceImage2 || message.params?.referenceImage3) && (
                        <div className="user-reference-images edit-ref-images">
                          {(['img1', 'img2', 'img3'] as const).map((slot, i) => {
                            const src = editRefImages[slot];
                            const slotNum = (i + 1) as 1 | 2 | 3;
                            return src ? (
                              <div key={slot} className="edit-ref-image-tile">
                                <img src={src} alt={`参考图 ${slotNum}`} className="edit-ref-thumb" />
                                <button
                                  type="button"
                                  className="edit-ref-remove"
                                  onClick={() => setEditRefImages(prev => ({ ...prev, [slot]: null }))}
                                  aria-label={`移除参考图 ${slotNum}`}
                                >
                                  <CloseOutlined />
                                </button>
                                <button
                                  type="button"
                                  className="edit-ref-replace"
                                  onClick={() => { activeRefSlot.current = slotNum; editFileInputRef.current?.click(); }}
                                  aria-label={`更换参考图 ${slotNum}`}
                                >
                                  <EditOutlined />
                                </button>
                              </div>
                            ) : (
                              <button
                                key={slot}
                                type="button"
                                className="edit-ref-add"
                                onClick={() => { activeRefSlot.current = slotNum; editFileInputRef.current?.click(); }}
                                aria-label={`添加参考图 ${slotNum}`}
                              >
                                <PlusOutlined />
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* 提示词文本编辑 */}
                      <Input.TextArea
                        className="edit-content-textarea"
                        value={editContent}
                        onChange={e => setEditContent(e.target.value)}
                        autoSize={{ minRows: 2, maxRows: 8 }}
                        placeholder="输入提示词…"
                        aria-label="提示词"
                      />

                      {/* 尾帧提示词（flf2v 循环模式） */}
                      {message.params?.isLoop && (
                        <Input.TextArea
                          className="edit-content-textarea edit-content-textarea-end"
                          value={editPromptEnd}
                          onChange={e => setEditPromptEnd(e.target.value)}
                          autoSize={{ minRows: 2, maxRows: 4 }}
                          placeholder="结束帧提示词…"
                          aria-label="结束帧提示词"
                        />
                      )}

                      {/* 参数标签（只读）+ 操作按钮 */}
                      {message.params && (
                        <div className="chat-message-params">
                          <Tag>{message.params.workflow}</Tag>
                          {message.params.strength != null && <Tag>强度: {message.params.strength}</Tag>}
                          {message.params.count != null && message.params.count > 1 && <Tag>数量: {message.params.count}</Tag>}
                          {message.params.loraPrompt && <Tag>LoRA: {message.params.loraPrompt}</Tag>}
                        </div>
                      )}
                      <div className="edit-actions">
                        <Button
                          type="primary"
                          size="small"
                          icon={<CheckOutlined />}
                          onClick={() => confirmEdit(message.id)}
                          disabled={!editContent.trim()}
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
                        { src: message.params.referenceImage, label: '参考图 1' },
                        { src: message.params.referenceImage2, label: '参考图 2' },
                        { src: message.params.referenceImage3, label: '参考图 3' },
                        { src: message.params.referenceImageEnd, label: '尾帧参考图' },
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
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="chat-message-text">{message.content}</div>
                  {message.params?.isLoop && message.params?.promptEnd && (
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
                        <Tag>LoRA: {message.params.loraPrompt}</Tag>
                      )}
                      {message.params.frameRate != null && (
                        <Tag>帧率: {message.params.frameRate}</Tag>
                      )}
                      {message.params.startFrameCount != null && (
                        <Tag>起始帧: {message.params.startFrameCount}</Tag>
                      )}
                      {message.params.isLoop && message.params.endFrameCount != null && (
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
                      disabled={isGenerating}
                      onClick={() => startEdit(message)}
                      aria-label="编辑并重新生成"
                    />
                    <Popconfirm
                      title="确认删除这轮对话？"
                      onConfirm={() => deleteChatMessage(message.id)}
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
                    {message.images.map((image, imgIndex) => (
                    <div
                      key={imgIndex}
                      className={`chat-image-item ${typeof image === 'string' && stripImageKeys.has(`${message.id}:${imgIndex}`) ? 'is-strip' : ''}`}
                      tabIndex={typeof image === 'string' ? 0 : undefined}
                      aria-label={typeof image === 'string' ? `生成结果 ${imgIndex + 1}` : undefined}
                    >
                      {typeof image === 'string' ? (() => {
                        const mediaKey = `${message.id}:${imgIndex}`;
                        const video = isVideo(image);
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
                    ))}
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
