import { useState, useRef, useEffect, useMemo, lazy, Suspense } from 'react';
import { Input, Button, message, Select, Image } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { 
  ArrowUpOutlined,
  SettingOutlined, 
  PictureOutlined, 
  BulbOutlined,
  CloseOutlined,
  PlusOutlined,
  UserOutlined,
  FontColorsOutlined,
  VideoCameraOutlined,
  CheckOutlined,
  SwapOutlined
} from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import { useShallow } from 'zustand/react/shallow';
import { apiService } from '../api/services';
import { compactReferenceImages, getImageGenerationSettings, getGenerationCount, getWorkflowOptions, getWorkflowMethods } from '../utils/workflowOptions';
import { compactImageReferences, getImageMentionError, getPresetBlocker, supportsImageMentions } from '../utils/imageMentions';
import type { PromptPreset } from '../types/api';
import ImageMentionInput from './ImageMentionInput';
import PromptPresetTag from './PromptPresetTag';
import PromptPresetQuickSelect from './PromptPresetQuickSelect';
import MotionReferenceImages from './MotionReferenceImages';
import { motionPromptSource, motionPromptSourceKey, rebindMotionPrompt, resolveMotionPrompt } from '../utils/motionPrompt';
import { getMotionReferenceError } from '../utils/motionReferences';
import './ChatInput.css';

const SettingsModal = lazy(() => import('./SettingsModal'));
const PromptExpansionModal = lazy(() => import('./PromptExpansionModal'));
const PoseEditorWeb = lazy(() => import('./PoseEditorWeb'));

const { TextArea } = Input;

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

type WorkflowKind = 'text' | 'image' | 'video';

interface WorkflowSelectOption {
  label: string;
  value: string;
  description: string;
  methodCount: number;
  kind: WorkflowKind;
}

function WorkflowKindIcon({ kind }: { kind: WorkflowKind }) {
  if (kind === 'video') return <VideoCameraOutlined />;
  if (kind === 'image') return <PictureOutlined />;
  return <FontColorsOutlined />;
}

interface FrameCardProps {
  image: string | null;
  label: string;
  alt: string;
  onUpload: () => void;
  onRemove: () => void;
}

function FrameCard({ image, label, alt, onUpload, onRemove }: FrameCardProps) {
  return (
    <div className={`keyframe-frame-card ${image ? 'has-image' : ''}`}>
      {image ? (
        <>
          <Image src={image} alt={alt} preview={{ mask: '预览' }} />
          <button
            type="button"
            className="keyframe-frame-card-remove"
            onClick={onRemove}
            aria-label={`移除${alt}`}
          >
            <CloseOutlined />
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="frame-upload-button"
            onClick={onUpload}
            aria-label={`上传${label}`}
          >
            <span className="keyframe-frame-placeholder">
              <PlusOutlined className="keyframe-frame-placeholder-icon" />
              <span className="keyframe-frame-placeholder-label">{label}</span>
            </span>
          </button>
        </>
      )}
    </div>
  );
}

interface ReferenceThumbnailProps {
  image: string;
  index: number;
  onRemove: () => void;
}

function ReferenceThumbnail({ image, index, onRemove }: ReferenceThumbnailProps) {
  return (
    <div className="reference-thumbnail">
      <Image src={image} alt={`参考图 ${index}`} preview={{ mask: null }} />
      <span className="reference-thumbnail-index" aria-hidden="true">{index}</span>
      <button
        type="button"
        className="reference-thumbnail-remove"
        onClick={onRemove}
        aria-label={`移除参考图 ${index}`}
      >
        <CloseOutlined />
      </button>
    </div>
  );
}

export default function ChatInput() {
  const {
    prompt,
    promptPreset,
    strength,
    count,
    loraPrompt,
    currentWorkflow,
    availableWorkflows,
    rememberedMethod,
    referenceImage,
    referenceImage2,
    referenceImage3,
    referenceImageEnd,
    isGenerating,
    currentSessionId,
    setPrompt,
    setPromptPreset,
    setCurrentWorkflow,
    setReferenceImage,
    setReferenceImages,
    setReferenceImage2,
    setReferenceImage3,
    setReferenceImageEnd,
    setError,
    clearError,
  } = useAppStore(useShallow(state => ({
    prompt: state.prompt,
    promptPreset: state.promptPreset,
    strength: state.strength,
    count: state.count,
    loraPrompt: state.loraPrompt,
    currentWorkflow: state.currentWorkflow,
    availableWorkflows: state.availableWorkflows,
    rememberedMethod: state.rememberedMethod,
    referenceImage: state.referenceImage,
    referenceImage2: state.referenceImage2,
    referenceImage3: state.referenceImage3,
    referenceImageEnd: state.referenceImageEnd,
    isGenerating: state.isGenerating,
    currentSessionId: state.currentSessionId,
    setPrompt: state.setPrompt,
    setPromptPreset: state.setPromptPreset,
    setCurrentWorkflow: state.setCurrentWorkflow,
    setReferenceImage: state.setReferenceImage,
    setReferenceImages: state.setReferenceImages,
    setReferenceImage2: state.setReferenceImage2,
    setReferenceImage3: state.setReferenceImage3,
    setReferenceImageEnd: state.setReferenceImageEnd,
    setError: state.setError,
    clearError: state.clearError,
  })));
  const workflowMeta = availableWorkflows.find(w => w.key === currentWorkflow);
  const motionReferenceImages = useAppStore(state => state.motionReferenceImages);
  const setMotionReferenceImages = useAppStore(state => state.setMotionReferenceImages);
  const isMotionReference = workflowMeta?.supports_motion_reference === true;
  const storedMotionPrompt = useAppStore(state => state.motionPrompt);
  const history = useAppStore(state => state.chatHistory);
  const motionSource = useMemo(() => motionPromptSource(referenceImage, motionReferenceImages, prompt, promptPreset), [referenceImage, motionReferenceImages, prompt, promptPreset]);
  const motionSnapshot = useMemo(() => resolveMotionPrompt(storedMotionPrompt, history, motionSource), [storedMotionPrompt, history, motionSource]);
  const motionRequestKey = JSON.stringify([currentSessionId, currentWorkflow, motionPromptSourceKey(motionSource)]);
  const mentionsEnabled = supportsImageMentions(workflowMeta);
  const generationProgress = useAppStore(state => state.generationProgress);
  const acceptsSketch = !!workflowMeta?.image_workflow;
  const isFrameVideo = workflowMeta?.supports_optional_keyframes === true;
  const isRequiresImage = workflowMeta?.requires_image === true && !isFrameVideo;
  const acceptsOptionalImages = workflowMeta?.supports_multi_image === true && !workflowMeta.requires_image;
  const supportsMultiImage = workflowMeta?.supports_multi_image === true; // 多参考图工作流（图生图类目）
  const acceptsReferenceImages = isRequiresImage || isFrameVideo || supportsMultiImage || acceptsSketch;
  // 预设显示在输入框上方，输入框只写具体要求；缺图等问题在标签上提示，发送时拦截。
  const presetIssue = promptPreset
    ? getPresetBlocker(promptPreset, workflowMeta, [referenceImage, referenceImage2, referenceImage3], referenceImageEnd, motionReferenceImages) : null;
  const presetPlaceholder = promptPreset ? (promptPreset.hint || '补充具体要求…') : undefined;

  // 下拉分组：同 category 的工作流折叠为一项。
  const groupedOptions = (() => {
    const seen = new Set<string>();
    const out: WorkflowSelectOption[] = [];
    for (const w of availableWorkflows) {
      const label = w.category || w.label;
      if (seen.has(label)) continue;
      seen.add(label);

      const members = w.category
        ? availableWorkflows.filter(item => item.category === w.category)
        : [w];
      const kind: WorkflowKind = members.some(item => item.output_type === 'video')
        ? 'video'
        : members.some(item => item.requires_image || item.supports_multi_image)
          ? 'image'
          : 'text';
      const description = kind === 'video'
        ? '从文字或参考帧生成动态视频'
        : kind === 'image'
          ? '通过文字或参考图生成图像'
          : '从文字描述开始创作图像';

      out.push({
        label,
        value: w.key,
        description,
        methodCount: getWorkflowMethods(members).length,
        kind,
      });
    }
    return out;
  })();
  // 下拉显示值：当前工作流属于某分组时，映射到该组首成员的 value，保证选中态正确
  const selectValue = workflowMeta?.category
    ? (groupedOptions.find(o => o.label === workflowMeta.category)?.value ?? currentWorkflow)
    : currentWorkflow;
  const [isDragging, setIsDragging] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [promptExpansionOpen, setPromptExpansionOpen] = useState(false);
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [poseWebOpen, setPoseWebOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadingMotion, setUploadingMotion] = useState(false);
  const [generatingMotionPrompt, setGeneratingMotionPrompt] = useState(false);
  const motionPromptRequest = useRef<AbortController | null>(null);
  const motionPromptMounted = useRef(true);
  useEffect(() => {
    motionPromptMounted.current = true;
    return () => { motionPromptMounted.current = false; motionPromptRequest.current?.abort(); };
  }, []);
  useEffect(() => () => { motionPromptRequest.current?.abort(); }, [motionRequestKey]);
  const [poseWebTargetSlot, setPoseWebTargetSlot] = useState<1 | 2 | 3>(1);
  const poseSessionRef = useRef<string | null>(null);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef2 = useRef<HTMLInputElement>(null);
  const fileInputRef3 = useRef<HTMLInputElement>(null);
  const fileInputEndRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<TextAreaRef>(null);
  const submissionPendingRef = useRef(false);
  const hasReferenceImages = Boolean(referenceImage || referenceImage2 || referenceImage3);
  const canAddReference = !supportsMultiImage || !(referenceImage && referenceImage2 && referenceImage3);

  const getNextReferenceSlot = (): 1 | 2 | 3 => {
    if (!referenceImage || !supportsMultiImage) return 1;
    if (!referenceImage2) return 2;
    return 3;
  };

  const openReferenceImagePicker = () => {
    const slot = getNextReferenceSlot();
    if (slot === 1) fileInputRef.current?.click();
    else if (slot === 2) fileInputRef2.current?.click();
    else fileInputRef3.current?.click();
  };

  const openPoseReference = () => {
    if (isMotionReference && motionReferenceImages.length >= 8) { message.warning('最多添加 8 张动作参考图'); return; }
    poseSessionRef.current = currentSessionId;
    setPoseWebTargetSlot(getNextReferenceSlot());
    setPoseWebOpen(true);
  };

  const generateMotionPrompt = async () => {
    if (motionPromptRequest.current || isGenerating || isSubmitting || uploadingMotion) return;
    const issue = getMotionReferenceError(referenceImage, motionReferenceImages) || presetIssue;
    if (issue) { message.warning(issue); return; }
    const controller = new AbortController();
    motionPromptRequest.current = controller;
    setGeneratingMotionPrompt(true);
    try {
      const result = await apiService.analyzeMotionPrompt(motionSource, controller.signal);
      const snapshot = await rebindMotionPrompt(result, motionPromptSource(referenceImage, motionReferenceImages, result.prompt, promptPreset));
      const state = useAppStore.getState();
      const latestKey = JSON.stringify([state.currentSessionId, state.currentWorkflow,
        motionPromptSourceKey(motionPromptSource(state.referenceImage, state.motionReferenceImages, state.prompt, state.promptPreset))]);
      if (controller.signal.aborted || !motionPromptMounted.current || latestKey !== motionRequestKey || state.isGenerating) return;
      useAppStore.setState({ prompt: result.prompt, motionPrompt: snapshot });
      useAppStore.getState().saveSessionConfig();
      requestAnimationFrame(() => textAreaRef.current?.focus({ cursor: 'end' }));
      message.success('提示词已填入输入框');
    } catch (error) {
      if (!controller.signal.aborted && motionPromptMounted.current) message.error(getErrorMessage(error));
    } finally {
      if (motionPromptRequest.current === controller) {
        motionPromptRequest.current = null;
        if (motionPromptMounted.current) setGeneratingMotionPrompt(false);
      }
    }
  };

  const swapFrameImages = () => {
    if (!referenceImage && !referenceImageEnd) return;
    useAppStore.setState({
      referenceImage: referenceImageEnd || null,
      referenceImageEnd: referenceImage || null,
    });
    useAppStore.getState().saveSessionConfig();
  };

  // 组件加载或切换会话时自动聚焦到输入框，并将光标移到末尾
  useEffect(() => {
    if (textAreaRef.current?.resizableTextArea?.textArea) {
      const textarea = textAreaRef.current.resizableTextArea.textArea;
      textarea.focus();
      // 将光标移到文本末尾
      const length = textarea.value.length;
      textarea.setSelectionRange(length, length);
    }
  }, [currentSessionId]); // 监听 currentSessionId 变化

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.currentTarget.value = '';

    const isImage = file.type.startsWith('image/');
    if (!isImage) {
      message.error('只能上传图片文件!');
      return;
    }

    const isLt10M = file.size / 1024 / 1024 < 10;
    if (!isLt10M) {
      message.error('图片大小不能超过 10MB!');
      return;
    }

    try {
      const res = await apiService.uploadImage(file);
      setReferenceImage(res.image);
      message.success('\u4e0a\u4f20\u6210\u529f!');
    } catch (err: unknown) {
      const errorMessage = getErrorMessage(err);
      setError(errorMessage);
      message.error('\u4e0a\u4f20\u5931\u8d25: ' + errorMessage);
    }
  };

  const makeImageUploadHandler = (setter: (img: string | null) => void, label = '\u4e0a\u4f20\u6210\u529f!') =>
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.currentTarget.value = '';
      if (!file.type.startsWith('image/')) { message.error('\u53ea\u80fd\u4e0a\u4f20\u56fe\u7247\u6587\u4ef6!'); return; }
      if (file.size / 1024 / 1024 >= 10) { message.error('\u56fe\u7247\u5927\u5c0f\u4e0d\u80fd\u8d85\u8fc7 10MB!'); return; }
      try {
        const res = await apiService.uploadImage(file);
        setter(res.image);
        message.success(label);
      } catch (err: unknown) {
        const errorMessage = getErrorMessage(err);
        setError(errorMessage);
        message.error('\u4e0a\u4f20\u5931\u8d25: ' + errorMessage);
      }
    };

  const handleSend = async () => {
    const { isGenerating } = useAppStore.getState();
    
    if (isGenerating) {
      try {
        await useAppStore.getState().stopGeneration();
        message.info('已停止生成');
      } catch (error) {
        message.error('停止生成失败: ' + getErrorMessage(error));
      }
      return;
    }

    if (submissionPendingRef.current) return;
    if (uploadingMotion) { message.warning('请等待动作图上传完成'); return; }
    if (generatingMotionPrompt) { message.warning('请等待提示词生成完成'); return; }
    if (isMotionReference) {
      const error = getMotionReferenceError(referenceImage, motionReferenceImages);
      if (error) { message.warning(error); return; }
    }

    if (promptPreset && presetIssue) { message.warning(`预设「${promptPreset.title}」：${presetIssue}`); return; }

    const mentionError = mentionsEnabled ? getImageMentionError(prompt, [referenceImage, referenceImage2, referenceImage3]) : null;
    if (mentionError) { message.warning(mentionError); return; }

    if (isRequiresImage && !hasReferenceImages) {
      message.warning(`请上传${workflowMeta?.reference_image_label || '参考图片'}`);
      return;
    }

    clearError();
    submissionPendingRef.current = true;
    setIsSubmitting(true);

    // 添加聊天消息（用户输入 + 加载占位符）
    // 使用用户选择的工作流
    const hasStrength = workflowMeta?.parameters?.some(p => p.name === 'strength') ?? false;
    const effectiveStrength = hasStrength ? strength : undefined;
    const effectiveCount = getGenerationCount(workflowMeta, count);
    const workflowOptions = getWorkflowOptions(workflowMeta, useAppStore.getState().selectOptions);
    const references = isMotionReference ? [referenceImage] : [referenceImage, referenceImage2, referenceImage3];
    const submittedMotionImages = isMotionReference ? [...motionReferenceImages] : undefined;
    const submittedMotionPrompt = isMotionReference && motionSnapshot?.prompt.trim() ? {...motionSnapshot} : undefined;
    const submittedPrompt = mentionsEnabled ? compactImageReferences(prompt, references).prompt : prompt;
    const [image1, image2, image3] = compactReferenceImages(references);
    const imageSettings = getImageGenerationSettings(workflowMeta, useAppStore.getState(), Boolean(image1));
    let messageId = '';
    try {
      const addedMessage = await useAppStore.getState().addChatMessage({
        prompt: submittedPrompt,
        workflow: currentWorkflow,
        strength: effectiveStrength,
        count: effectiveCount,
        loraPrompt,
        ...imageSettings,
        referenceImage: image1,
        referenceImage2: image2,
        referenceImage3: image3,
        referenceImageEnd: isFrameVideo ? referenceImageEnd : undefined,
        motionReferenceImages: submittedMotionImages,
        motionPrompt: submittedMotionPrompt,
        workflowOptions,
        promptPreset,
      });
      if (!addedMessage) return;
      messageId = addedMessage.messageId;
      const generationTaskId = crypto.randomUUID();
      useAppStore.getState().startGeneration(messageId, generationTaskId);

      const state = useAppStore.getState();

      // 接口立即返回，生成在后台执行，结果和错误通过 WebSocket 推送
      await apiService.generateMedia({
        prompt: submittedPrompt,
        workflow: currentWorkflow,
        strength: effectiveStrength,
        count: effectiveCount,
        lora_prompt: loraPrompt || undefined,
        reference_image: image1,
        reference_image_2: image2,
        reference_image_3: image3,
        width: imageSettings.width,
        height: imageSettings.height,
        reference_image_end: isFrameVideo ? (referenceImageEnd || undefined) : undefined,
        motion_reference_images: submittedMotionImages,
        motion_prompt: submittedMotionPrompt,
        use_original_size: imageSettings.useOriginalSize,
        // PixelLab 动画参数
        action: currentWorkflow === 'pixel_lab_animate' ? state.pixelLabAction : undefined,
        view: currentWorkflow === 'pixel_lab_animate' ? state.pixelLabView : undefined,
        direction: currentWorkflow === 'pixel_lab_animate' ? state.pixelLabDirection : undefined,
        workflow_options: workflowOptions,
        prompt_preset: promptPreset ?? undefined,
        // 任务关联：让后端落库 + 断线恢复能定位到助手消息
        message_id: messageId,
        session_id: addedMessage.sessionId,
        task_id: generationTaskId,
      });
    } catch (err: unknown) {
      // HTTP 层面失败（任务未能提交到后台）
      if (messageId) useAppStore.getState().updateChatImages(messageId, []);
      useAppStore.getState().finishGeneration();
      const errorMessage = getErrorMessage(err);
      setError(errorMessage);
      message.error('提交失败: ' + errorMessage);
    } finally {
      submissionPendingRef.current = false;
      setIsSubmitting(false);
    }
  };

  // 应用 AI 生成的 Prompt
  const handleApplyPrompt = (generatedPrompt: string) => {
    const error = mentionsEnabled ? getImageMentionError(generatedPrompt, [referenceImage, referenceImage2, referenceImage3]) : null;
    if (error) { message.warning(error); return false; }
    setPrompt(generatedPrompt);
    message.success('扩写结果已应用到输入框');
    return true;
  };

  // 预设不写进输入框，选中后光标回到描述末尾，方便接着补充具体要求
  const handleApplyPreset = (preset: PromptPreset | null) => {
    setPromptPreset(preset);
    requestAnimationFrame(() => {
      const textarea = textAreaRef.current?.resizableTextArea?.textArea;
      textarea?.focus();
      textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  };

  // 共享的图片上传逻辑（拖放/粘贴均复用）
  const uploadImageFile = async (file: File) => {
    const isImage = file.type.startsWith('image/');
    if (!isImage) {
      message.error('只能上传图片文件!');
      return;
    }

    const isLt10M = file.size / 1024 / 1024 < 10;
    if (!isLt10M) {
      message.error('图片大小不能超过 10MB!');
      return;
    }

    // 首尾帧模式下：首帧已有图时自动填充尾帧
    const currentState = useAppStore.getState();
    const fillEnd = isFrameVideo && currentState.referenceImage && !currentState.referenceImageEnd;

    // 普通 requires_image 模式：按序填充槽位
    // 支持多图的工作流最多 3 张；其余参考图工作流仅 1 张
    const getNextSlot = () => {
      if (!currentState.referenceImage) return setReferenceImage;
      if (supportsMultiImage && !currentState.referenceImage2) return setReferenceImage2;
      if (supportsMultiImage && !currentState.referenceImage3) return setReferenceImage3;
      return setReferenceImage; // 全满时替换第 1 张
    };

    try {
      const res = await apiService.uploadImage(file);
      if (useAppStore.getState().currentSessionId !== currentState.currentSessionId) return;
      if (isMotionReference && currentState.referenceImage) {
        const images = useAppStore.getState().motionReferenceImages;
        if (images.length >= 8) { message.warning('最多添加 8 张动作参考图'); return; }
        setMotionReferenceImages([...images, res.image]);
      } else if (fillEnd) {
        setReferenceImageEnd(res.image);
        message.success('\u5c3e\u5e27\u4e0a\u4f20\u6210\u529f!');
      } else if (isRequiresImage || supportsMultiImage) {
        getNextSlot()(res.image);
        message.success('\u4e0a\u4f20\u6210\u529f!');
      } else {
        setReferenceImage(res.image);
        message.success('\u4e0a\u4f20\u6210\u529f!');
      }
    } catch (err: unknown) {
      const errorMessage = getErrorMessage(err);
      setError(errorMessage);
      message.error('上传失败: ' + errorMessage);
    }
  };

  // 粘贴处理（Ctrl/Cmd + V）：将剪切板中的图片作为参考图
  const handlePaste = async (e: React.ClipboardEvent) => {
    // 文生图不允许上传图片
    if (!acceptsReferenceImages) return;

    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;

    let imageFile: File | null = null;
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) {
          imageFile = f;
          break;
        }
      }
    }

    if (!imageFile) return; // 没有图片则让浏览器执行默认粘贴（文本）

    e.preventDefault();
    await uploadImageFile(imageFile);
  };

  // 拖放处理
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    // 只有当计数器归零时才隐藏遮罩
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);

    // 文生图不允许拖放图片
    if (!acceptsReferenceImages) return;

    // URL 直接设置的辅助函数（拖放 URL 时的 fallback）
    const setImageUrl = (url: string) => {
      const currentState = useAppStore.getState();
      const fillEnd = isFrameVideo && currentState.referenceImage && !currentState.referenceImageEnd;
      if (isMotionReference && currentState.referenceImage) {
        if (currentState.motionReferenceImages.length >= 8) { message.warning('最多添加 8 张动作参考图'); return; }
        setMotionReferenceImages([...currentState.motionReferenceImages, url]);
      } else if (fillEnd) {
        setReferenceImageEnd(url);
        message.success('尾帧已设置!');
      } else if (isRequiresImage || supportsMultiImage) {
        if (!currentState.referenceImage) { setReferenceImage(url); }
        else if (supportsMultiImage && !currentState.referenceImage2) { setReferenceImage2(url); }
        else if (supportsMultiImage && !currentState.referenceImage3) { setReferenceImage3(url); }
        else { setReferenceImage(url); }
        message.success('图片已设置!');
      } else {
        setReferenceImage(url);
        message.success('图片已设置!');
      }
    };

    // 情况1：拖放的是文件
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      for (const file of isMotionReference ? Array.from(files) : [files[0]]) await uploadImageFile(file);
      return;
    }

    // 情况2：拖放的是图片 URL（从网页拖放图片）
    // 尝试获取图片 URL
    const imageUrl = e.dataTransfer.getData('text/uri-list') || 
                     e.dataTransfer.getData('text/plain');
    
    // 检查是否是有效的图片路径（支持相对路径、绝对URL、data URL）
    const isValidImagePath = imageUrl && (
      imageUrl.startsWith('http://') || 
      imageUrl.startsWith('https://') || 
      imageUrl.startsWith('data:') ||
      imageUrl.startsWith('/uploads/') ||  // 本站生成的图片相对路径
      imageUrl.startsWith('/')  // 其他相对路径
    );
    
    if (isValidImagePath) {
      try {
        message.loading({ content: '正在处理图片...', key: 'dropImage' });
        
        // 构建完整 URL
        let fullUrl = imageUrl;
        if (imageUrl.startsWith('/')) {
          fullUrl = window.location.origin + imageUrl;
        }
        
        // 如果是 data URL，直接转换
        if (imageUrl.startsWith('data:')) {
          const res = await fetch(imageUrl);
          const blob = await res.blob();
          const file = new File([blob], `dropped-image-${Date.now()}.png`, { type: blob.type || 'image/png' });
          message.destroy('dropImage');
          await uploadImageFile(file);
          return;
        }

        // 如果是 HTTP URL，尝试 fetch
        const res = await fetch(fullUrl);
        if (!res.ok) {
          throw new Error('无法获取图片');
        }
        const blob = await res.blob();
        
        // 检查是否是图片
        if (!blob.type.startsWith('image/')) {
          message.destroy('dropImage');
          message.error('拖放的不是有效图片!');
          return;
        }
        
        const file = new File([blob], `dropped-image-${Date.now()}.png`, { type: blob.type });
        message.destroy('dropImage');
        await uploadImageFile(file);
      } catch (err: unknown) {
        message.destroy('dropImage');
        console.error('Drop image error:', err);
        // 如果 fetch 失败，尝试直接使用 URL 作为参考图
        if (imageUrl.startsWith('/')) {
          // 相对路径，构建完整 URL 后设置
          setImageUrl(window.location.origin + imageUrl);
        } else if (imageUrl.startsWith(window.location.origin)) {
          setImageUrl(imageUrl);
        } else {
          message.error('无法获取跨域图片，请尝试先保存到本地再上传');
        }
      }
    }
  };

  return (
    <div className="chat-input-wrapper">
      <div 
        ref={dropZoneRef}
        className={`chat-input-container ${isDragging ? 'drag-over' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onPaste={handlePaste}
      >
        {/* 拖放遮罩层（文生图不显示） */}
        {isDragging && acceptsReferenceImages && (
          <div className="chat-drag-overlay">
            <PictureOutlined className="chat-drag-icon" />
            <span className="chat-drag-text">松开以上传图片</span>
          </div>
        )}

        {promptPreset && (
          <div className="chat-input-preset-row">
            <PromptPresetTag
              preset={promptPreset}
              issue={presetIssue}
              onRemove={() => setPromptPreset(null)}
              onChange={() => setPresetMenuOpen(true)}
            />
          </div>
        )}

        {/* 首尾帧输入布局 / 普通图文输入布局 */}
        {isFrameVideo ? (
          <div className="keyframe-input-area">
            {/* 双帧卡片区 */}
            <div className="keyframe-frames">
              <div className="keyframe-frame-row">
                <FrameCard
                  image={referenceImage}
                  label="首帧·可选"
                  alt="开始帧"
                  onUpload={() => fileInputRef.current?.click()}
                  onRemove={() => setReferenceImage(null)}
                />

                <button
                  type="button"
                  className="keyframe-frame-swap"
                  onClick={swapFrameImages}
                  disabled={!referenceImage && !referenceImageEnd}
                  title={referenceImage && referenceImageEnd
                    ? '互换首帧和尾帧'
                    : referenceImage
                      ? '将首帧移至尾帧'
                      : referenceImageEnd
                        ? '将尾帧移至首帧'
                        : '添加图片后可移动'}
                  aria-label="互换首帧和尾帧"
                >
                  <SwapOutlined aria-hidden="true" />
                </button>

                <FrameCard
                  image={referenceImageEnd}
                  label="尾帧·可选"
                  alt="结束帧"
                  onUpload={() => fileInputEndRef.current?.click()}
                  onRemove={() => setReferenceImageEnd(null)}
                />
              </div>

            </div>

            {/* 右侧：文字描述 */}
            <div className="keyframe-prompts">
              <div className="keyframe-prompt-item">
                <span className="keyframe-prompt-label">音视频描述</span>
                <TextArea
                  ref={textAreaRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={presetPlaceholder ?? '描述镜头、动作、对白、音效与配乐...'}
                  aria-label="音视频描述"
                  className="chat-textarea"
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  onPressEnter={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                />
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* 输入框行：仅展示已添加的紧凑参考图，不预占空槽 */}
            <div className="chat-input-row">
              {hasReferenceImages && (
                <div className="reference-strip" aria-label="参考图片">
                  {referenceImage && (
                    <ReferenceThumbnail
                      image={referenceImage}
                      index={1}
                      onRemove={() => setReferenceImages([null, referenceImage2, referenceImage3])}
                    />
                  )}
                  {!isMotionReference && referenceImage2 && (
                    <ReferenceThumbnail
                      image={referenceImage2}
                      index={2}
                      onRemove={() => setReferenceImages([referenceImage, null, referenceImage3])}
                    />
                  )}
                  {!isMotionReference && referenceImage3 && (
                    <ReferenceThumbnail
                      image={referenceImage3}
                      index={3}
                      onRemove={() => setReferenceImage3(null)}
                    />
                  )}
                </div>
              )}
              <div className="chat-textarea-wrapper">
                <ImageMentionInput
                  ref={textAreaRef}
                  value={prompt}
                  onChange={setPrompt}
                  images={[referenceImage, referenceImage2, referenceImage3]}
                  enabled={mentionsEnabled}
                  placeholder={presetPlaceholder ?? (isMotionReference ? '动作按参考图生成；仅补充节奏、停顿、音效等额外内容，可留空…' : workflowMeta?.reference_image_description && hasReferenceImages ? workflowMeta.reference_image_description : acceptsSketch ? '描述画面，也可添加图片进行编辑…' : acceptsOptionalImages ? '输入指令（可加载参考图）...' : '描述你想要生成的图片...')}
                  aria-label="生成提示词"
                  className="chat-textarea"
                  autoSize={{ minRows: 1, maxRows: 6 }}
                  onPressEnter={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                />
              </div>
            </div>
          </>
        )}

        {isMotionReference && <MotionReferenceImages key={`motion-images-${currentSessionId ?? 'new'}`} images={motionReferenceImages}
          onChange={setMotionReferenceImages} onCapture={openPoseReference} onUploadingChange={setUploadingMotion} disabled={isSubmitting}
          shotMode={promptPreset?.motion_reference_mode === 'shot'} />}

        {isGenerating && generationProgress && (
          <div className="generation-stage-progress" role="status">{generationProgress}</div>
        )}
        {/* 第二行：功能按钮 */}
        <div className="chat-input-buttons">
          <div className="chat-input-tools">
            {/* 图片上传 */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleImageUpload}
            />
            <input
              ref={fileInputRef2}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={makeImageUploadHandler(setReferenceImage2)}
            />
            <input
              ref={fileInputRef3}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={makeImageUploadHandler(setReferenceImage3)}
            />
            {/* 尾帧上传 */}
            <input
              ref={fileInputEndRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (!file.type.startsWith('image/')) { message.error('只能上传图片文件!'); return; }
                if (file.size / 1024 / 1024 >= 10) { message.error('图片大小不能超过 10MB!'); return; }
                try {
                  const res = await apiService.uploadImage(file);
                  setReferenceImageEnd(res.image);
                  message.success('结束帧上传成功!');
                } catch (err: unknown) {
                  message.error('上传失败: ' + getErrorMessage(err));
                }
              }}
            />

            <div className="chat-input-reference-actions">
              <PromptPresetQuickSelect preset={promptPreset} workflowMeta={workflowMeta} onChange={handleApplyPreset}
                open={presetMenuOpen} onOpenChange={setPresetMenuOpen}
                onGeneratePrompt={isMotionReference ? () => void generateMotionPrompt() : undefined}
                generatingPrompt={generatingMotionPrompt} generatePromptDisabled={isGenerating || isSubmitting || uploadingMotion}
                generatePromptBlockedReason={isMotionReference ? getMotionReferenceError(referenceImage, motionReferenceImages) || presetIssue : null} />
              {(isRequiresImage || supportsMultiImage || acceptsSketch) && (
                <button
                  type="button"
                  className="chat-input-attachment-button"
                  onClick={openReferenceImagePicker}
                  disabled={!canAddReference}
                  title={!canAddReference ? '最多添加 3 张参考图' : acceptsSketch ? '添加或替换参考图' : '添加参考图'}
                  aria-label={canAddReference ? '添加参考图' : '参考图已达上限'}
                >
                  <PictureOutlined aria-hidden="true" />
                  <span>参考图</span>
                </button>
              )}
            </div>
            {(isRequiresImage || supportsMultiImage || acceptsSketch) && (
                <button
                  type="button"
                  className="chat-input-attachment-button"
                  onClick={openPoseReference}
                  disabled={!canAddReference}
                  title={canAddReference ? '从姿势编辑器添加参考图' : '最多添加 3 张参考图'}
                  aria-label={canAddReference ? '添加姿势参考图' : '参考图已达上限'}
                >
                  <UserOutlined aria-hidden="true" />
                  <span>姿势图</span>
                </button>
            )}

            {/* 参数设置 */}
            <button 
              type="button"
              className="chat-input-icon-button" 
              title="参数设置"
              aria-label="打开生成设置"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingOutlined />
            </button>

            {/* 扩写助手 */}
            <button
              type="button"
              className="chat-input-icon-button"
              onClick={() => setPromptExpansionOpen(true)}
              title="扩写助手"
              aria-label="打开扩写助手"
            >
              <BulbOutlined />
            </button>

            {/* 工作流选择器（图生图等同类工作流折叠为一项，具体方式在生成设置里选择） */}
            <Select
              className="workflow-select"
              classNames={{ popup: { root: 'workflow-select-popup' } }}
              value={selectValue}
              onChange={(val) => {
                const target = availableWorkflows.find(w => w.key === val);
                if (target?.category) {
                  // 多方式分组（如图生图、图生视频）：用该类目记住的方式；单方式分组：直接取该唯一成员
                  const groupKeys = availableWorkflows
                    .filter(w => w.category === target.category)
                    .map(w => w.key);
                  const remembered = rememberedMethod[target.category];
                  const method = groupKeys.length > 1 && remembered && groupKeys.includes(remembered)
                    ? remembered
                    : (groupKeys[0] ?? val);
                  setCurrentWorkflow(method);
                } else {
                  setCurrentWorkflow(val);
                }
              }}
              popupMatchSelectWidth={false}
              options={groupedOptions}
              labelRender={({ value }) => {
                const option = groupedOptions.find(item => item.value === value);
                if (!option) return value;
                return (
                  <span className="workflow-select-label">
                    <span className="workflow-select-label-icon" aria-hidden="true">
                      <WorkflowKindIcon kind={option.kind} />
                    </span>
                    <span className="workflow-select-label-text">{option.label}</span>
                    {workflowMeta?.method && (
                      <span className="workflow-select-current-method">{workflowMeta.method}</span>
                    )}
                  </span>
                );
              }}
              optionRender={(option) => {
                const item = groupedOptions.find(candidate => candidate.value === option.value);
                if (!item) return option.label;
                const isSelected = item.value === selectValue;
                return (
                  <div className="workflow-option">
                    <span className="workflow-option-icon" aria-hidden="true">
                      <WorkflowKindIcon kind={item.kind} />
                    </span>
                    <span className="workflow-option-copy">
                      <span className="workflow-option-heading">
                        <span className="workflow-option-title">{item.label}</span>
                        {item.methodCount > 1 && (
                          <span className="workflow-option-count">{item.methodCount} 种方式</span>
                        )}
                      </span>
                      <span className="workflow-option-description">{item.description}</span>
                    </span>
                    <CheckOutlined
                      className={`workflow-option-check ${isSelected ? 'is-visible' : ''}`}
                      aria-hidden="true"
                    />
                  </div>
                );
              }}
              aria-label="选择生成工作流"
            />
          </div>

          {/* 发送/停止按钮 */}
          <Button
            type="primary"
            icon={isGenerating ? <span className="chat-stop-icon" aria-hidden="true" /> : <ArrowUpOutlined />}
            onClick={handleSend}
            disabled={isSubmitting || (!isGenerating && !!isRequiresImage && !hasReferenceImages)}
            loading={isSubmitting}
            className="chat-send-button"
            danger={isGenerating}
            aria-label={isGenerating ? '停止生成' : '开始生成'}
            title={isGenerating ? '停止生成' : '开始生成'}
          />
        </div>
      </div>

      <Suspense fallback={<div className="lazy-component-loading" role="status">正在加载设置...</div>}>
        {settingsOpen && (
          <SettingsModal
            open
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </Suspense>

      <Suspense fallback={<div className="lazy-component-loading" role="status">正在加载扩写助手...</div>}>
        {promptExpansionOpen && (
          <PromptExpansionModal
            open
            onClose={() => setPromptExpansionOpen(false)}
            onApply={handleApplyPrompt}
            workflowId={currentWorkflow}
            inputPrompt={prompt}
          />
        )}
      </Suspense>

      {/* 姿势参考弹窗 */}
      <Suspense fallback={null}>
        {poseWebOpen && (
          <PoseEditorWeb
            open={poseWebOpen}
            onClose={() => setPoseWebOpen(false)}
            targetSlot={poseWebTargetSlot}
            targetLabel={isMotionReference ? `动作图 ${motionReferenceImages.length + 1}` : undefined}
            onApplyImage={(base64) => {
              if (poseSessionRef.current !== useAppStore.getState().currentSessionId) return;
              if (isMotionReference) {
                const images = useAppStore.getState().motionReferenceImages;
                if (images.length < 8) setMotionReferenceImages([...images, base64]);
                return;
              }
              if (poseWebTargetSlot === 1) setReferenceImage(base64);
              else if (poseWebTargetSlot === 2) setReferenceImage2(base64);
              else setReferenceImage3(base64);
            }}
          />
        )}
      </Suspense>
    </div>
  );
}
