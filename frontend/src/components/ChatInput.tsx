import { useState, useRef, useEffect } from 'react';
import { Input, Button, message, Select, Image, Switch } from 'antd';
import { 
  SendOutlined, 
  SettingOutlined, 
  PictureOutlined, 
  ThunderboltOutlined,
  CloseOutlined,
  StopOutlined,
  PlusOutlined
} from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import { apiService } from '../api/services';
import SettingsModal from './SettingsModal';
import AIPromptModal from './AIPromptModal';
import './ChatInput.css';

const { TextArea } = Input;

export default function ChatInput() {
  const {
    prompt,
    promptEnd,
    strength,
    count,
    loraPrompt,
    currentWorkflow,
    availableWorkflows,
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
  } = useAppStore();
  const workflowMeta = availableWorkflows.find(w => w.key === currentWorkflow);
  const isFlf2v = workflowMeta?.requires_end_image === true;
  const isRequiresImage = workflowMeta?.requires_image === true && !isFlf2v;
  const isI2I = currentWorkflow === 'i2i'; // Q-Image：最多 3 张参考图
  const isNanoBananaPro = currentWorkflow === 'nano_banana_pro'; // Gemini 多轮对话
  const isT2I = !isRequiresImage && !isFlf2v && !isNanoBananaPro; // 文生图：不允许上传图片
  const [isDragging, setIsDragging] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiPromptOpen, setAiPromptOpen] = useState(false);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef2 = useRef<HTMLInputElement>(null);
  const fileInputRef3 = useRef<HTMLInputElement>(null);
  const fileInputEndRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<any>(null);

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
    } catch (err: any) {
      setError(err.message);
      message.error('\u4e0a\u4f20\u5931\u8d25: ' + err.message);
    }
  };

  const makeImageUploadHandler = (setter: (img: string | null) => void, label = '\u4e0a\u4f20\u6210\u529f!') =>
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) { message.error('\u53ea\u80fd\u4e0a\u4f20\u56fe\u7247\u6587\u4ef6!'); return; }
      if (file.size / 1024 / 1024 >= 10) { message.error('\u56fe\u7247\u5927\u5c0f\u4e0d\u80fd\u8d85\u8fc7 10MB!'); return; }
      try {
        const res = await apiService.uploadImage(file);
        setter(res.image);
        message.success(label);
      } catch (err: any) {
        setError(err.message);
        message.error('\u4e0a\u4f20\u5931\u8d25: ' + err.message);
      }
    };

  const handleSend = async () => {
    const { isGenerating } = useAppStore.getState();
    
    if (isGenerating) {
      // 停止生成
      useAppStore.getState().stopGeneration();
      message.info('已停止生成');
      return;
    }

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

    // 添加聊天消息（用户输入 + 加载占位符）
    // 使用用户选择的工作流
    const hasStrength = workflowMeta?.parameters?.some(p => p.name === 'strength') ?? false;
    const effectiveStrength = hasStrength ? strength : undefined;
    const messageId = await useAppStore.getState().addChatMessage({
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
      frameRate: isFlf2v ? frameRate : undefined,
      startFrameCount: isFlf2v ? startFrameCount : undefined,
      endFrameCount: isFlf2v ? endFrameCount : undefined,
    });

    try {
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
        frame_rate: isFlf2v ? (state.frameRate ?? undefined) : undefined,
        // Gemini 多轮对话（nano_banana_pro 开关开时附加）
        send_history: isNanoBananaPro ? nanoBananaSendHistory : undefined,
        session_id: isNanoBananaPro && nanoBananaSendHistory ? (currentSessionId || undefined) : undefined,
      });
      // 携带历史发送时清空输入框（普通模式提示词随工作流保留）
      if (isNanoBananaPro && nanoBananaSendHistory) {
        setPrompt('');
      }
    } catch (err: any) {
      // HTTP 层面失败（任务未能提交到后台）
      useAppStore.getState().updateChatImages(messageId, []);
      useAppStore.setState({ currentGeneratingMessageId: null, isGenerating: false });
      setError(err.message);
      message.error('提交失败: ' + err.message);
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
        if ((isI2I || isNanoBananaPro) && !currentState.referenceImage2) return setReferenceImage2;
        if ((isI2I || isNanoBananaPro) && !currentState.referenceImage3) return setReferenceImage3;
        return setReferenceImage; // 全满时替换第 1 张
      };

      try {
        const res = await apiService.uploadImage(file);
        if (fillEnd) {
          setReferenceImageEnd(res.image);
          message.success('\u5c3e\u5e27\u4e0a\u4f20\u6210\u529f!');
        } else if (isRequiresImage) {
          getNextSlot()(res.image);
          message.success('\u4e0a\u4f20\u6210\u529f!');
        } else {
          setReferenceImage(res.image);
          message.success('\u4e0a\u4f20\u6210\u529f!');
        }
      } catch (err: any) {
        setError(err.message);
        message.error('上传失败: ' + err.message);
      }
    };

    // URL 直接设置的辅助函数（拖放 URL 时的 fallback）
    const setImageUrl = (url: string) => {
      const currentState = useAppStore.getState();
      const fillEnd = isFlf2v && currentState.referenceImage && !currentState.referenceImageEnd;
      if (fillEnd) {
        setReferenceImageEnd(url);
        message.success('尾帧已设置!');
      } else if (isRequiresImage) {
        if (!currentState.referenceImage) { setReferenceImage(url); }
        else if ((isI2I || isNanoBananaPro) && !currentState.referenceImage2) { setReferenceImage2(url); }
        else if ((isI2I || isNanoBananaPro) && !currentState.referenceImage3) { setReferenceImage3(url); }
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
      } catch (err: any) {
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

              {/* 开始帧 */}
              <div
                className={`flf2v-frame-card ${referenceImage ? 'has-image' : ''}`}
                onClick={() => !referenceImage && fileInputRef.current?.click()}
                title="上传开始帧"
              >
                {referenceImage ? (
                  <>
                    <Image
                      src={referenceImage}
                      alt="开始帧"
                      width={76}
                      height={76}
                      style={{ objectFit: 'cover', display: 'block' }}
                      preview={{ mask: '预览' }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div
                      className="flf2v-frame-card-remove"
                      onClick={(e) => { e.stopPropagation(); setReferenceImage(null); }}
                    >
                      <CloseOutlined />
                    </div>
                  </>
                ) : (
                  <div className="flf2v-frame-placeholder">
                    <PlusOutlined className="flf2v-frame-placeholder-icon" />
                    <span className="flf2v-frame-placeholder-label">首帧</span>
                  </div>
                )}
              </div>

              {/* 中间：箭头 + 循环开关 */}
              <div className="flf2v-separator-col">
                <span className="flf2v-frame-separator">⇄</span>
                {workflowMeta?.supports_loop && (
                  <div className="flf2v-loop-toggle">
                    <Switch
                      size="small"
                      checked={isLoop}
                      onChange={setIsLoop}
                    />
                    <span className="flf2v-loop-label">
                      {isLoop ? '循环' : '单程'}
                    </span>
                  </div>
                )}
              </div>

              {/* 结束帧 */}
              <div
                className={`flf2v-frame-card ${referenceImageEnd ? 'has-image' : ''}`}
                onClick={() => !referenceImageEnd && fileInputEndRef.current?.click()}
                title="上传结束帧"
              >
                {referenceImageEnd ? (
                  <>
                    <Image
                      src={referenceImageEnd}
                      alt="结束帧"
                      width={76}
                      height={76}
                      style={{ objectFit: 'cover', display: 'block' }}
                      preview={{ mask: '预览' }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div
                      className="flf2v-frame-card-remove"
                      onClick={(e) => { e.stopPropagation(); setReferenceImageEnd(null); }}
                    >
                      <CloseOutlined />
                    </div>
                  </>
                ) : (
                  <div className="flf2v-frame-placeholder">
                    <PlusOutlined className="flf2v-frame-placeholder-icon" />
                    <span className="flf2v-frame-placeholder-label">尾帧</span>
                  </div>
                )}
              </div>
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
                  className="chat-textarea"
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  onPressEnter={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
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
                    className="chat-textarea"
                    autoSize={{ minRows: 2, maxRows: 4 }}
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* 输入框行（requires_image 时包含帧卡片） */}
            <div className="chat-input-row">
              {(isRequiresImage || isNanoBananaPro) && (
                <>
                  {/* ── 参考图 1（所有 requires_image 工作流都有，Nano Banana Pro 可选） ── */}
                  <div
                    className={`flf2v-frame-card ${referenceImage ? 'has-image' : ''}`}
                    onClick={() => !referenceImage && fileInputRef.current?.click()}
                    title={isI2I ? '上传参考图 1' : isNanoBananaPro ? '上传参考图（可选）' : '上传参考图'}
                    style={{ flexShrink: 0 }}
                  >
                    {referenceImage ? (
                      <>
                        <Image
                          src={referenceImage}
                          alt="参考图 1"
                          width={76}
                          height={76}
                          style={{ objectFit: 'cover', display: 'block' }}
                          preview={{ mask: '预览' }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div
                          className="flf2v-frame-card-remove"
                          onClick={(e) => { e.stopPropagation(); setReferenceImage(referenceImage2); setReferenceImage2(referenceImage3); setReferenceImage3(null); }}
                        >
                          <CloseOutlined />
                        </div>
                      </>
                    ) : (
                      <div className="flf2v-frame-placeholder">
                        <PlusOutlined className="flf2v-frame-placeholder-icon" />
                        <span className="flf2v-frame-placeholder-label">
                          {isI2I ? '图 1' : isNanoBananaPro ? '参考图' : '参考图'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* ── 参考图 2 / 3（i2i 和 Nano Banana Pro，逐张追加） ── */}
                  {/* 图 1 已上传后才显示图 2 槽位 */}
                  {(isI2I || isNanoBananaPro) && referenceImage && (
                    <div
                      className={`flf2v-frame-card ${referenceImage2 ? 'has-image' : ''}`}
                      onClick={() => !referenceImage2 && fileInputRef2.current?.click()}
                      title={referenceImage2 ? '参考图 2' : '添加参考图 2（可选）'}
                      style={{ flexShrink: 0 }}
                    >
                      {referenceImage2 ? (
                        <>
                          <Image
                            src={referenceImage2}
                            alt="参考图 2"
                            width={76}
                            height={76}
                            style={{ objectFit: 'cover', display: 'block' }}
                            preview={{ mask: '预览' }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div
                            className="flf2v-frame-card-remove"
                            onClick={(e) => { e.stopPropagation(); setReferenceImage2(referenceImage3); setReferenceImage3(null); }}
                          >
                            <CloseOutlined />
                          </div>
                        </>
                      ) : (
                        <div className="flf2v-frame-placeholder">
                          <PlusOutlined className="flf2v-frame-placeholder-icon" />
                          <span className="flf2v-frame-placeholder-label">添加</span>
                        </div>
                      )}
                    </div>
                  )}
                  {/* 图 2 已上传后才显示图 3 槽位 */}
                  {(isI2I || isNanoBananaPro) && referenceImage2 && (
                    <div
                      className={`flf2v-frame-card ${referenceImage3 ? 'has-image' : ''}`}
                      onClick={() => !referenceImage3 && fileInputRef3.current?.click()}
                      title={referenceImage3 ? '参考图 3' : '添加参考图 3（可选）'}
                      style={{ flexShrink: 0 }}
                    >
                      {referenceImage3 ? (
                        <>
                          <Image
                            src={referenceImage3}
                            alt="参考图 3"
                            width={76}
                            height={76}
                            style={{ objectFit: 'cover', display: 'block' }}
                            preview={{ mask: '预览' }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div
                            className="flf2v-frame-card-remove"
                            onClick={(e) => { e.stopPropagation(); setReferenceImage3(null); }}
                          >
                            <CloseOutlined />
                          </div>
                        </>
                      ) : (
                        <div className="flf2v-frame-placeholder">
                          <PlusOutlined className="flf2v-frame-placeholder-icon" />
                          <span className="flf2v-frame-placeholder-label">添加</span>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
              <div className="chat-textarea-wrapper">
                <TextArea
                  ref={textAreaRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={isNanoBananaPro ? '输入指令（可加载参考图）...' : '描述你想要生成的图片...'}
                  className="chat-textarea"
                  autoSize={{ minRows: (isRequiresImage || isNanoBananaPro) ? 1 : 2, maxRows: 6 }}
                  onPressEnter={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
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
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
                } catch (err: any) {
                  message.error('上传失败: ' + err.message);
                }
              }}
            />
            {/* 预留：文生图不显示上传按钮（isT2I 时无任何图片入口） */}

            {/* 参数设置 */}
            <button 
              className="chat-input-icon-button" 
              title="参数设置"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingOutlined />
            </button>

            {/* AI 生成 */}
            <button
              className="chat-input-icon-button"
              onClick={() => setAiPromptOpen(true)}
              title="AI 生成英文 Prompt"
            >
              <ThunderboltOutlined />
            </button>

            {/* Gemini 历史对话开关（仅 nano_banana_pro 工作流显示） */}
            {isNanoBananaPro && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Switch
                  size="small"
                  checked={nanoBananaSendHistory}
                  onChange={setNanoBananaSendHistory}
                />
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  携带历史
                </span>
              </div>
            )}

            {/* 工作流选择器 */}
            <Select
              value={currentWorkflow}
              onChange={setCurrentWorkflow}
              size="small"
              style={{ minWidth: 155, width: 'auto', maxWidth: 260 }}
              popupMatchSelectWidth={false}
              options={availableWorkflows.map(w => ({
                label: w.label,
                value: w.key,
              }))}
            />
          </div>

          {/* 发送/停止按钮 */}
          <Button
            type="primary"
            icon={isGenerating ? <StopOutlined /> : <SendOutlined />}
            onClick={handleSend}
            disabled={!isGenerating && !!isRequiresImage && !referenceImage}
            className="chat-send-button"
            danger={isGenerating}
          />
        </div>
      </div>

      {/* 设置弹窗 */}
      <SettingsModal 
        open={settingsOpen} 
        onClose={() => setSettingsOpen(false)} 
      />

      {/* AI Prompt 生成弹窗 */}
      <AIPromptModal
        open={aiPromptOpen}
        onClose={() => setAiPromptOpen(false)}
        onApply={handleApplyPrompt}
        workflowId={currentWorkflow}
      />
    </div>
  );
}
