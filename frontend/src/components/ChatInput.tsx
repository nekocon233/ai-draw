import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { Input, Button, message, Select, Image, Switch } from 'antd';
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
  ArrowRightOutlined,
  SwapOutlined
} from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import { useShallow } from 'zustand/react/shallow';
import { apiService } from '../api/services';
import './ChatInput.css';

const SettingsModal = lazy(() => import('./SettingsModal'));
const PromptAssistantModal = lazy(() => import('./PromptAssistantModal'));
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
    <div className={`flf2v-frame-card ${image ? 'has-image' : ''}`}>
      {image ? (
        <>
          <Image src={image} alt={alt} preview={{ mask: '预览' }} />
          <button
            type="button"
            className="flf2v-frame-card-remove"
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
            <span className="flf2v-frame-placeholder">
              <PlusOutlined className="flf2v-frame-placeholder-icon" />
              <span className="flf2v-frame-placeholder-label">{label}</span>
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
    promptEnd,
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
    isLoop,
    frameRate,
    startFrameCount,
    endFrameCount,
    frameCount,
    nanoBananaSendHistory,
    setPrompt,
    setPromptEnd,
    setCurrentWorkflow,
    setReferenceImage,
    setReferenceImage2,
    setReferenceImage3,
    setReferenceImageEnd,
    setIsLoop,
    setNanoBananaSendHistory,
    setError,
    clearError,
  } = useAppStore(useShallow(state => ({
    prompt: state.prompt,
    promptEnd: state.promptEnd,
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
    isLoop: state.isLoop,
    frameRate: state.frameRate,
    startFrameCount: state.startFrameCount,
    endFrameCount: state.endFrameCount,
    frameCount: state.frameCount,
    nanoBananaSendHistory: state.nanoBananaSendHistory,
    setPrompt: state.setPrompt,
    setPromptEnd: state.setPromptEnd,
    setCurrentWorkflow: state.setCurrentWorkflow,
    setReferenceImage: state.setReferenceImage,
    setReferenceImage2: state.setReferenceImage2,
    setReferenceImage3: state.setReferenceImage3,
    setReferenceImageEnd: state.setReferenceImageEnd,
    setIsLoop: state.setIsLoop,
    setNanoBananaSendHistory: state.setNanoBananaSendHistory,
    setError: state.setError,
    clearError: state.clearError,
  })));
  const workflowMeta = availableWorkflows.find(w => w.key === currentWorkflow);
  const isFlf2v = workflowMeta?.requires_end_image === true;
  const isI2V = currentWorkflow === 'i2v'; // Wan i2v：图生视频
  const isRequiresImage = workflowMeta?.requires_image === true && !isFlf2v;
  const isNanoBananaPro = currentWorkflow === 'nano_banana_pro'; // Gemini 多轮对话
  const isKlingFlf2v = currentWorkflow === 'kling_flf2v'; // Kling 首尾帧图生视频
  const supportsMultiImage = workflowMeta?.supports_multi_image === true; // 多参考图工作流（图生图类目）
  const isT2I = !isRequiresImage && !isFlf2v && !supportsMultiImage; // 文生图：不允许上传图片

  // 下拉分组：同 category 的工作流折叠为一项（如 图生图：i2i / nano_banana_pro）
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
        ? '用参考帧生成动态视频'
        : kind === 'image'
          ? '上传参考图进行编辑与重绘'
          : '从文字描述开始创作图像';

      out.push({
        label,
        value: w.key,
        description,
        methodCount: members.length,
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
  const [promptAssistantOpen, setPromptAssistantOpen] = useState(false);
  const [poseWebOpen, setPoseWebOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [poseWebTargetSlot, setPoseWebTargetSlot] = useState<1 | 2 | 3>(1);
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
    setPoseWebTargetSlot(getNextReferenceSlot());
    setPoseWebOpen(true);
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

    if (isFlf2v && !referenceImage) {
      message.warning('请上传开始帧图片');
      return;
    }

    if (isFlf2v && !referenceImageEnd) {
      message.warning('请上传结束帧图片');
      return;
    }

    if (isRequiresImage && !isNanoBananaPro && !referenceImage) {
      message.warning('请上传参考图片');
      return;
    }

    clearError();
    submissionPendingRef.current = true;
    setIsSubmitting(true);

    // 添加聊天消息（用户输入 + 加载占位符）
    // 使用用户选择的工作流
    const hasStrength = workflowMeta?.parameters?.some(p => p.name === 'strength') ?? false;
    const effectiveStrength = hasStrength ? strength : undefined;
    let messageId = '';
    try {
      messageId = await useAppStore.getState().addChatMessage({
        prompt,
        workflow: currentWorkflow,
        strength: effectiveStrength,
        count,
        loraPrompt,
        promptEnd: isFlf2v && isLoop ? promptEnd : undefined,
        referenceImage,
        referenceImage2: referenceImage2 || undefined,
        referenceImage3: referenceImage3 || undefined,
        referenceImageEnd: isFlf2v ? referenceImageEnd : undefined,
        isLoop: isFlf2v ? isLoop : undefined,
        frameRate: isFlf2v ? frameRate : (isI2V ? frameRate : undefined),
        startFrameCount: isFlf2v ? startFrameCount : undefined,
        endFrameCount: isFlf2v ? endFrameCount : undefined,
        frameCount: isI2V ? frameCount : undefined,
      });
      if (!messageId) return;

      const state = useAppStore.getState();

      // 接口立即返回，生成在后台执行，结果和错误通过 WebSocket 推送
      await apiService.generateMedia({
        prompt,
        workflow: currentWorkflow,
        strength,
        count,
        lora_prompt: loraPrompt || undefined,
        reference_image: referenceImage || undefined,
        reference_image_2: referenceImage2 || undefined,
        reference_image_3: referenceImage3 || undefined,
        width: state.width || undefined,
        height: state.height || undefined,
        prompt_end: isFlf2v && isLoop ? (promptEnd || undefined) : undefined,
        reference_image_end: isFlf2v ? (referenceImageEnd || undefined) : undefined,
        use_original_size: state.useOriginalSize,
        is_loop: isFlf2v ? isLoop : undefined,
        start_frame_count: isFlf2v ? (state.startFrameCount ?? undefined) : undefined,
        end_frame_count: isFlf2v ? (state.endFrameCount ?? undefined) : undefined,
        frame_rate: (isFlf2v || isI2V) ? (state.frameRate ?? undefined) : undefined,
        frame_count: isI2V ? (state.frameCount ?? undefined) : undefined,
        // Gemini 多轮对话（nano_banana_pro 开关开时附加）
        send_history: isNanoBananaPro ? nanoBananaSendHistory : undefined,
        session_id: isNanoBananaPro && nanoBananaSendHistory ? (currentSessionId || undefined) : undefined,
        // PixelLab 动画参数
        action: currentWorkflow === 'pixel_lab_animate' ? state.pixelLabAction : undefined,
        view: currentWorkflow === 'pixel_lab_animate' ? state.pixelLabView : undefined,
        direction: currentWorkflow === 'pixel_lab_animate' ? state.pixelLabDirection : undefined,
        // Kling 视频运行时选项（前端用 selectOptions 存储）
        kling_options: isKlingFlf2v ? state.selectOptions : undefined,
      });
      // 携带历史发送时清空输入框和参考图（普通模式下提示词随会话保留）
      if (isNanoBananaPro && nanoBananaSendHistory) {
        setPrompt('');
        setReferenceImage(null);
        setReferenceImage2(null);
        setReferenceImage3(null);
      }
    } catch (err: unknown) {
      // HTTP 层面失败（任务未能提交到后台）
      if (messageId) useAppStore.getState().updateChatImages(messageId, []);
      useAppStore.setState({ currentGeneratingMessageId: null, isGenerating: false });
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
    setPrompt(generatedPrompt);
    message.success('Prompt 已应用到输入框');
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
    if (isT2I) return;

    // 辅助函数：上传文件
    // flf2v 模式下：首帧已有图时自动填充尾帧
    const uploadFile = async (file: File) => {
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

      // 判断要填充首帧还是尾帧
      const currentState = useAppStore.getState();
      const fillEnd = isFlf2v && currentState.referenceImage && !currentState.referenceImageEnd;

      // 普通 requires_image 模式：按序填充槽位
      // Q-Image (i2i) / Nano Banana Pro：最多 3 张；参考图工作流：仅 1 张
      const getNextSlot = () => {
        if (!currentState.referenceImage) return setReferenceImage;
        if (supportsMultiImage && !currentState.referenceImage2) return setReferenceImage2;
        if (supportsMultiImage && !currentState.referenceImage3) return setReferenceImage3;
        return setReferenceImage; // 全满时替换第 1 张
      };

      try {
        const res = await apiService.uploadImage(file);
        if (fillEnd) {
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

    // URL 直接设置的辅助函数（拖放 URL 时的 fallback）
    const setImageUrl = (url: string) => {
      const currentState = useAppStore.getState();
      const fillEnd = isFlf2v && currentState.referenceImage && !currentState.referenceImageEnd;
      if (fillEnd) {
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
      await uploadFile(files[0]);
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
          await uploadFile(file);
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
        await uploadFile(file);
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
      >
        {/* 拖放遮罩层（文生图不显示） */}
        {isDragging && !isT2I && (
          <div className="chat-drag-overlay">
            <PictureOutlined className="chat-drag-icon" />
            <span className="chat-drag-text">松开以上传图片</span>
          </div>
        )}

        {/* flf2v 双帧输入布局 / 普通图文输入布局 */}
        {isFlf2v ? (
          <div className="flf2v-input-area">
            {/* 双帧卡片区 */}
            <div className="flf2v-frames">
              <div className="flf2v-frame-row">
                <FrameCard
                  image={referenceImage}
                  label="首帧"
                  alt="开始帧"
                  onUpload={() => fileInputRef.current?.click()}
                  onRemove={() => setReferenceImage(null)}
                />

                <button
                  type="button"
                  className="flf2v-frame-swap"
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
                  label="尾帧"
                  alt="结束帧"
                  onUpload={() => fileInputEndRef.current?.click()}
                  onRemove={() => setReferenceImageEnd(null)}
                />
              </div>

              {workflowMeta?.supports_loop && (
                <div className="flf2v-mode-switch" role="group" aria-label="视频过渡模式">
                  <button
                    type="button"
                    className={`flf2v-mode-option${!isLoop ? ' is-active' : ''}`}
                    onClick={() => setIsLoop(false)}
                    aria-pressed={!isLoop}
                  >
                    <ArrowRightOutlined aria-hidden="true" />
                    <span>单程</span>
                  </button>
                  <button
                    type="button"
                    className={`flf2v-mode-option${isLoop ? ' is-active' : ''}`}
                    onClick={() => setIsLoop(true)}
                    aria-pressed={isLoop}
                  >
                    <SwapOutlined aria-hidden="true" />
                    <span>循环</span>
                  </button>
                </div>
              )}
            </div>

            {/* 右侧：文字描述 */}
            <div className={`flf2v-prompts${isLoop ? ' flf2v-prompts--loop' : ''}`}>
              <div className="flf2v-prompt-item">
                <span className="flf2v-prompt-label">首帧描述</span>
                <TextArea
                  ref={textAreaRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="描述开始帧画面内容..."
                  aria-label="首帧描述"
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
              {isLoop && <div className="flf2v-prompt-divider" />}
              {isLoop && (
                <div className="flf2v-prompt-item">
                  <span className="flf2v-prompt-label">尾帧描述</span>
                  <TextArea
                    value={promptEnd}
                    onChange={(e) => setPromptEnd(e.target.value)}
                    placeholder="描述结束帧画面内容..."
                    aria-label="尾帧描述"
                    className="chat-textarea"
                    autoSize={{ minRows: 2, maxRows: 4 }}
                  />
                </div>
              )}
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
                      onRemove={() => {
                        setReferenceImage(referenceImage2);
                        setReferenceImage2(referenceImage3);
                        setReferenceImage3(null);
                      }}
                    />
                  )}
                  {referenceImage2 && (
                    <ReferenceThumbnail
                      image={referenceImage2}
                      index={2}
                      onRemove={() => {
                        setReferenceImage2(referenceImage3);
                        setReferenceImage3(null);
                      }}
                    />
                  )}
                  {referenceImage3 && (
                    <ReferenceThumbnail
                      image={referenceImage3}
                      index={3}
                      onRemove={() => setReferenceImage3(null)}
                    />
                  )}
                </div>
              )}
              <div className="chat-textarea-wrapper">
                <TextArea
                  ref={textAreaRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={isNanoBananaPro ? '输入指令（可加载参考图）...' : '描述你想要生成的图片...'}
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
            {/* flf2v 结束帧上传 */}
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

            {(isRequiresImage || supportsMultiImage) && (
              <>
                <button
                  type="button"
                  className="chat-input-attachment-button"
                  onClick={openReferenceImagePicker}
                  disabled={!canAddReference}
                  title={canAddReference ? '添加普通参考图' : '最多添加 3 张参考图'}
                  aria-label={canAddReference ? '添加普通参考图' : '参考图已达上限'}
                >
                  <PictureOutlined aria-hidden="true" />
                  <span>普通图</span>
                </button>
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
              </>
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

            {/* 提示词助手 */}
            <button
              type="button"
              className="chat-input-icon-button"
              onClick={() => setPromptAssistantOpen(true)}
              title="提示词助手"
              aria-label="打开提示词助手"
            >
              <BulbOutlined />
            </button>

            {/* Gemini 历史对话开关（仅 nano_banana_pro 工作流显示） */}
            {isNanoBananaPro && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Switch
                  size="small"
                  checked={nanoBananaSendHistory}
                  onChange={setNanoBananaSendHistory}
                  aria-label="携带历史对话"
                />
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  携带历史
                </span>
              </div>
            )}

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
            disabled={isSubmitting || (!isGenerating && !!isRequiresImage && !referenceImage)}
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

      <Suspense fallback={<div className="lazy-component-loading" role="status">正在加载提示词助手...</div>}>
        {promptAssistantOpen && (
          <PromptAssistantModal
            open
            onClose={() => setPromptAssistantOpen(false)}
            onApply={handleApplyPrompt}
            onApplyEnd={(p) => { setPromptEnd(p); message.success('尾帧描述已应用'); }}
            workflowId={currentWorkflow}
            workflowMeta={workflowMeta}
            initialPrompt={prompt}
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
            onApplyImage={(base64) => {
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
