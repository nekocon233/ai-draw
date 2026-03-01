import { useState, useRef, useEffect } from 'react';
import { Input, Button, message, Select, Image } from 'antd';
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
    referenceImageEnd,
    isGenerating,
    currentSessionId,
    setPrompt,
    setPromptEnd,
    setCurrentWorkflow,
    setReferenceImage,
    setReferenceImageEnd,
    setError,
    clearError,
  } = useAppStore();
  const workflowMeta = availableWorkflows.find(w => w.key === currentWorkflow);
  const isFlf2v = workflowMeta?.requires_end_image === true;
  const isRequiresImage = workflowMeta?.requires_image === true && !isFlf2v;
  const [isDragging, setIsDragging] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiPromptOpen, setAiPromptOpen] = useState(false);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
      message.success('上传成功!');
    } catch (err: any) {
      setError(err.message);
      message.error('上传失败: ' + err.message);
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

    if (isRequiresImage && !referenceImage) {
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
      promptEnd: isFlf2v ? promptEnd : undefined,
      referenceImage,
      referenceImageEnd: isFlf2v ? referenceImageEnd : undefined,
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
        width: state.width || undefined,
        height: state.height || undefined,
        prompt_end: isFlf2v ? (promptEnd || undefined) : undefined,
        reference_image_end: isFlf2v ? (referenceImageEnd || undefined) : undefined,
        use_original_size: state.useOriginalSize,
      });
      // 任务已提交，无需在此处理结果
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

      try {
        const res = await apiService.uploadImage(file);
        if (fillEnd) {
          setReferenceImageEnd(res.image);
          message.success('尾帧上传成功!');
        } else {
          setReferenceImage(res.image);
          message.success('上传成功!');
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
        {/* 拖放遮罩层 */}
        {isDragging && (
          <div className="chat-drag-overlay">
            <PictureOutlined className="chat-drag-icon" />
            <span className="chat-drag-text">松开以上传图片</span>
          </div>
        )}

        {/* flf2v 双帧输入布局 / 普通图文输入布局 */}
        {isFlf2v ? (
          <div className="flf2v-input-area">
            {/* 双帧卡片 */}
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

              {/* 分隔符 */}
              <span className="flf2v-frame-separator">⇄</span>

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

            {/* 文本输入：首帧 + 尾帧描述 */}
            <div className="flf2v-prompts">
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
              <div className="flf2v-prompt-divider" />
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
            </div>
          </div>
        ) : (
          <>
            {/* 普通模式图片预览（非 requires_image 时） */}
            {!isRequiresImage && referenceImage && (
              <div className="chat-image-preview">
                <div className="chat-image-preview-item">
                  <Image
                    src={referenceImage}
                    alt="参考图"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    preview={{ mask: '预览' }}
                  />
                  <div
                    className="chat-image-preview-remove"
                    onClick={() => setReferenceImage(null)}
                  >
                    <CloseOutlined />
                  </div>
                </div>
              </div>
            )}

            {/* 输入框行（requires_image 时包含帧卡片） */}
            <div className="chat-input-row">
              {isRequiresImage && (
                <div
                  className={`flf2v-frame-card ${referenceImage ? 'has-image' : ''}`}
                  onClick={() => !referenceImage && fileInputRef.current?.click()}
                  title="上传参考图"
                  style={{ flexShrink: 0 }}
                >
                  {referenceImage ? (
                    <>
                      <Image
                        src={referenceImage}
                        alt="参考图"
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
                      <span className="flf2v-frame-placeholder-label">参考图</span>
                    </div>
                  )}
                </div>
              )}
              <div className="chat-textarea-wrapper">
                <TextArea
                  ref={textAreaRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="描述你想要生成的图片..."
                  className="chat-textarea"
                  autoSize={{ minRows: isRequiresImage ? 1 : 2, maxRows: 6 }}
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
            {!isFlf2v && !isRequiresImage && (
              <button
                className="chat-input-icon-button"
                onClick={() => fileInputRef.current?.click()}
                title="上传图片"
              >
                <PictureOutlined />
              </button>
            )}

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

            {/* 工作流选择器 */}
            <Select
              value={currentWorkflow}
              onChange={setCurrentWorkflow}
              size="small"
              style={{ width: 155 }}
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
            disabled={!isGenerating && !!(isFlf2v || isRequiresImage) && !referenceImage}
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
      />
    </div>
  );
}
