import { useState, useRef, useEffect } from 'react';
import { Input, Button, Dropdown, message } from 'antd';
import { 
  SendOutlined, 
  SettingOutlined, 
  PictureOutlined, 
  ThunderboltOutlined,
  CloseOutlined,
  StopOutlined
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useAppStore } from '../stores/appStore';
import { apiService } from '../api/services';
import { WORKFLOW_TYPES } from '../utils/constants';
import SettingsModal from './SettingsModal';
import AIPromptModal from './AIPromptModal';
import './ChatInput.css';

const { TextArea } = Input;

export default function ChatInput() {
  const {
    prompt,
    strength,
    count,
    loraPrompt,
    currentWorkflow,
    referenceImage,
    isGenerating,
    setPrompt,
    setCurrentWorkflow,
    setReferenceImage,
    setError,
    clearError,
  } = useAppStore();

  const [workflows] = useState<string[]>([...WORKFLOW_TYPES]);
  const [isDragging, setIsDragging] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiPromptOpen, setAiPromptOpen] = useState(false);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<any>(null);

  // 组件加载时自动聚焦到输入框，并将光标移到末尾
  useEffect(() => {
    if (textAreaRef.current?.resizableTextArea?.textArea) {
      const textarea = textAreaRef.current.resizableTextArea.textArea;
      textarea.focus();
      // 将光标移到文本末尾
      const length = textarea.value.length;
      textarea.setSelectionRange(length, length);
    }
  }, []);

  // 工作流下拉菜单
  const workflowMenu: MenuProps = {
    items: workflows.map(workflow => ({
      key: workflow,
      label: workflow,
      onClick: () => handleWorkflowChange(workflow),
    })),
  };

  // 参数设置下拉菜单
  const handleWorkflowChange = async (workflow: string) => {
    try {
      await apiService.switchWorkflow(workflow);
      setCurrentWorkflow(workflow);
      message.success(`已切换到 ${workflow} 工作流`);
    } catch (err: any) {
      setError(err.message);
      message.error('切换工作流失败');
    }
  };

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

    if (!prompt.trim()) {
      message.warning('请先输入提示词');
      return;
    }

    clearError();

    // 添加聊天消息（用户输入 + 加载占位符）
    const messageId = useAppStore.getState().addChatMessage(prompt, currentWorkflow, strength, count, loraPrompt);

    try {
      const res = await apiService.generateImage({
        prompt,
        strength,
        count,
        workflow_type: currentWorkflow,
        lora_prompt: loraPrompt || undefined,
        reference_image: referenceImage || undefined,
      });

      // 图片通过 WebSocket 实时推送，这里只等待生成完成
      // useAppStore.getState().updateChatImages(messageId, res.images);
      message.success(`成功生成 ${res.count} 张图片!`);
      // loading 状态由后端通过 WebSocket 自动设置为 false
    } catch (err: any) {
      // 生成失败，清除加载状态
      useAppStore.getState().updateChatImages(messageId, []);
      setError(err.message);
      message.error('生成失败: ' + err.message);
      // loading 状态由后端通过 WebSocket 自动设置为 false
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

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      
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

        {/* 图片预览 */}
        {referenceImage && (
          <div className="chat-image-preview">
            <div className="chat-image-preview-item">
              <img src={referenceImage} alt="参考图" />
              <div 
                className="chat-image-preview-remove"
                onClick={() => setReferenceImage(null)}
              >
                <CloseOutlined />
              </div>
            </div>
          </div>
        )}

        {/* 第一行：输入框 */}
        <div className="chat-input-row">
          <div className="chat-textarea-wrapper">
            <TextArea
              ref={textAreaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你想要生成的图片..."
              className="chat-textarea"
              autoSize={{ minRows: 2, maxRows: 6 }}
              onPressEnter={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
          </div>
        </div>

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
            <button
              className="chat-input-icon-button"
              onClick={() => fileInputRef.current?.click()}
              title="上传图片"
            >
              <PictureOutlined />
            </button>

            {/* 工作流选择 */}
            <Dropdown menu={workflowMenu} trigger={['click']} placement="topLeft">
              <button className="chat-input-icon-button" title={`当前工作流: ${currentWorkflow}`}>
                {currentWorkflow[0]}
              </button>
            </Dropdown>

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
          </div>

          {/* 发送/停止按钮 */}
          <Button
            type="primary"
            icon={isGenerating ? <StopOutlined /> : <SendOutlined />}
            onClick={handleSend}
            disabled={!isGenerating && !prompt.trim()}
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
