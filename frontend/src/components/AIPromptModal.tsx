import { useState } from 'react';
import { Modal, Input, Button, Space, message, Tabs, Upload, Tag } from 'antd';
import {
  ThunderboltOutlined,
  CopyOutlined,
  PictureOutlined,
  DeleteOutlined,
  UploadOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { apiService } from '../api/services';
import { useAppStore } from '../stores/appStore';

const { TextArea } = Input;

interface AIPromptModalProps {
  open: boolean;
  onClose: () => void;
  onApply: (prompt: string) => void;
  onApplyEnd?: (prompt: string) => void;
  workflowId?: string;
}

// ─────────────────────────────────────────────
// 子面板：文字描述 → 生成提示词
// ─────────────────────────────────────────────
function TextDescriptionPanel({
  workflowId,
  onApply,
  onClose,
}: {
  workflowId?: string;
  onApply: (p: string) => void;
  onClose: () => void;
}) {
  const [description, setDescription] = useState('');
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    if (!description.trim()) { message.warning('请输入中文描述'); return; }
    setLoading(true);
    try {
      const res = await apiService.generatePrompt({ description, workflow_id: workflowId });
      setGeneratedPrompt(res.prompt);
      message.success('Prompt 生成成功');
    } catch (err: any) {
      message.error('生成失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <div>
        <div style={{ marginBottom: 8, fontWeight: 500, color: 'var(--text-primary, #202124)' }}>
          中文描述
        </div>
        <TextArea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="用中文描述你想要生成的图片，例如：一只可爱的小猫在草地上玩耍"
          autoSize={{ minRows: 3, maxRows: 6 }}
          autoFocus
          style={{ borderRadius: '8px' }}
          onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); handleGenerate(); } }}
        />
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          onClick={handleGenerate}
          loading={loading}
          disabled={!description.trim()}
          style={{ marginTop: 12, width: '100%', height: '40px', borderRadius: '8px', fontWeight: 500 }}
        >
          AI 生成提示词
        </Button>
      </div>

      {generatedPrompt && (
        <div>
          <TextArea
            value={generatedPrompt}
            onChange={(e) => setGeneratedPrompt(e.target.value)}
            autoSize={{ minRows: 4, maxRows: 8 }}
            style={{ borderRadius: '8px', color: '#ffffff' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
            <Button
              icon={<CopyOutlined />}
              onClick={() => { navigator.clipboard.writeText(generatedPrompt); message.success('已复制到剪贴板'); }}
            >
              复制
            </Button>
            <Button
              type="primary"
              onClick={() => { onApply(generatedPrompt); onClose(); }}
            >
              应用到输入框
            </Button>
          </div>
        </div>
      )}
    </Space>
  );
}

// ─────────────────────────────────────────────
// 子面板：上传图片 → Gemini 分析 → 生成提示词
// ─────────────────────────────────────────────
function ImageAnalyzePanel({
  onApply,
  onClose,
}: {
  onApply: (p: string) => void;
  onClose: () => void;
}) {
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [extraDesc, setExtraDesc] = useState('');
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [loading, setLoading] = useState(false);

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setImageDataUrl(result);
      setImagePreview(result);
      setGeneratedPrompt('');
    };
    reader.readAsDataURL(file);
  };

  const handleUploadChange = (info: any) => {
    const file: File = info.file.originFileObj ?? info.file;
    if (file) readFile(file);
  };

  const handleAnalyze = async () => {
    if (!imageDataUrl) { message.warning('请先上传图片'); return; }
    if (!extraDesc.trim()) { message.warning('请指定要描述的内容'); return; }
    setLoading(true);
    try {
      const res = await apiService.analyzeImageForPrompt({
        image: imageDataUrl,
        description: extraDesc.trim(),
      });
      setGeneratedPrompt(res.prompt);
      message.success('提示词生成成功');
    } catch (err: any) {
      message.error('分析失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveImage = () => {
    setImageDataUrl(null);
    setImagePreview(null);
    setGeneratedPrompt('');
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {/* 图片上传区 */}
      <div>
        <div style={{ marginBottom: 8, fontWeight: 500, color: 'var(--text-primary, #202124)' }}>
          参考图片
        </div>
        {imagePreview ? (
          <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
            <img
              src={imagePreview}
              alt="preview"
              style={{
                width: '100%',
                maxHeight: 240,
                objectFit: 'contain',
                borderRadius: 8,
                border: '1px solid var(--border-color, #3c4043)',
                background: '#1a1a1a',
              }}
            />
            <Button
              danger
              size="small"
              icon={<DeleteOutlined />}
              onClick={handleRemoveImage}
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                borderRadius: 6,
              }}
            >
              移除
            </Button>
          </div>
        ) : (
          <Upload
            accept="image/*"
            showUploadList={false}
            beforeUpload={() => false}
            onChange={handleUploadChange}
          >
            <div
              style={{
                width: '100%',
                height: 120,
                border: '1px dashed var(--border-color, #3c4043)',
                borderRadius: 8,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                gap: 8,
                color: 'var(--text-secondary, #9aa0a6)',
                transition: 'border-color 0.2s',
              }}
            >
              <UploadOutlined style={{ fontSize: 24 }} />
              <span style={{ fontSize: 13 }}>点击或拖拽图片到此处</span>
              <span style={{ fontSize: 11, opacity: 0.6 }}>支持 JPG / PNG / WEBP</span>
            </div>
          </Upload>
        )}
      </div>

      {/* 额外描述 */}
      <div>
        <div style={{ marginBottom: 6, fontSize: 13, color: 'var(--text-secondary, #9aa0a6)' }}>
          <span style={{ color: '#ff4d4f', marginRight: 4 }}>*</span>指定描述内容
        </div>
        <Input
          value={extraDesc}
          onChange={(e) => setExtraDesc(e.target.value)}
          placeholder="指定要描述的内容，如：镜头、动作、背景、风格…"
          style={{ borderRadius: 8 }}
          onPressEnter={handleAnalyze}
        />
      </div>

      {/* 分析按钮 */}
      <Button
        type="primary"
        icon={<PictureOutlined />}
        onClick={handleAnalyze}
        loading={loading}
        disabled={!imageDataUrl || !extraDesc.trim()}
        style={{ width: '100%', height: 40, borderRadius: 8, fontWeight: 500 }}
      >
        分析图片生成提示词
      </Button>

      {/* 生成结果 */}
      {generatedPrompt && (
        <div>
          <div style={{ marginBottom: 6, fontSize: 13, color: 'var(--text-secondary, #9aa0a6)' }}>
            生成结果（可编辑）
          </div>
          <TextArea
            value={generatedPrompt}
            onChange={(e) => setGeneratedPrompt(e.target.value)}
            autoSize={{ minRows: 4, maxRows: 8 }}
            style={{ borderRadius: 8, color: '#ffffff' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
            <Button
              icon={<CopyOutlined />}
              onClick={() => { navigator.clipboard.writeText(generatedPrompt); message.success('已复制到剪贴板'); }}
            >
              复制
            </Button>
            <Button
              type="primary"
              onClick={() => { onApply(generatedPrompt); onClose(); }}
            >
              应用到输入框
            </Button>
          </div>
        </div>
      )}
    </Space>
  );
}

// ─────────────────────────────────────────────
// 子面板：首尾帧分析 → 分别生成首帧/尾帧提示词（flf2v 专用）
// ─────────────────────────────────────────────
function Flf2vFrameAnalyzePanel({
  onApply,
  onApplyEnd,
  onClose,
}: {
  onApply: (p: string) => void;
  onApplyEnd?: (p: string) => void;
  onClose: () => void;
}) {
  const referenceImage = useAppStore((s) => s.referenceImage);
  const referenceImageEnd = useAppStore((s) => s.referenceImageEnd);
  const isLoop = useAppStore((s) => s.isLoop);
  const [extraDesc, setExtraDesc] = useState('');
  const [promptStart, setPromptStart] = useState('');
  const [promptEnd, setPromptEnd] = useState('');
  const [loading, setLoading] = useState(false);

  const hasStart = !!referenceImage;
  const hasEnd = !!referenceImageEnd;
  const canGenerate = hasStart || hasEnd;
  const hasResult = !!promptStart || !!promptEnd;

  const handleAnalyze = async () => {
    if (!canGenerate) { message.warning('请先在主界面上传首帧或尾帧图片'); return; }
    setLoading(true);
    try {
      const res = await apiService.analyzeFramesForPrompt({
        image_start: referenceImage || undefined,
        image_end: referenceImageEnd || undefined,
        description: extraDesc.trim() || undefined,
        is_loop: isLoop,
      });
      setPromptStart(res.prompt_start);
      setPromptEnd(res.prompt_end);
      message.success('提示词生成成功');
    } catch (err: any) {
      message.error('生成失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyAll = () => {
    if (promptStart) onApply(promptStart);
    if (promptEnd && onApplyEnd) onApplyEnd(promptEnd);
    onClose();
  };

  const framePreviewStyle: React.CSSProperties = {
    width: '100%',
    height: 120,
    objectFit: 'cover',
    borderRadius: 8,
    border: '1px solid var(--border-color, #3c4043)',
    background: '#1a1a1a',
  };

  const framePlaceholderStyle: React.CSSProperties = {
    ...framePreviewStyle,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    color: 'var(--text-secondary, #9aa0a6)',
    fontSize: 12,
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {/* 首尾帧预览 */}
      <div>
        <div style={{ marginBottom: 8, fontWeight: 500, color: 'var(--text-primary, #202124)' }}>
          已上传的首帧 / 尾帧
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary, #9aa0a6)', marginBottom: 4 }}>首帧</div>
            {hasStart ? (
              <img src={referenceImage} alt="首帧" style={framePreviewStyle} />
            ) : (
              <div style={framePlaceholderStyle as React.CSSProperties}>
                <PictureOutlined style={{ fontSize: 20 }} />
                <span>未上传首帧</span>
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary, #9aa0a6)', marginBottom: 4 }}>尾帧</div>
            {hasEnd ? (
              <img src={referenceImageEnd} alt="尾帧" style={framePreviewStyle} />
            ) : (
              <div style={framePlaceholderStyle as React.CSSProperties}>
                <PictureOutlined style={{ fontSize: 20 }} />
                <span>未上传尾帧</span>
              </div>
            )}
          </div>
        </div>
        {isLoop && (
          <div style={{ marginTop: 8 }}>
            <Tag color="gold" style={{ borderRadius: 6 }}>🔁 循环模式已开启：首尾帧提示词将分别描述各自的帧画面</Tag>
          </div>
        )}
        {!canGenerate && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#faad14', textAlign: 'center' }}>
            请先在主界面上传至少一张图片
          </div>
        )}
      </div>

      {/* 补充描述（可选） */}
      <div>
        <div style={{ marginBottom: 6, fontSize: 13, color: 'var(--text-secondary, #9aa0a6)' }}>
          补充描述（可选）
        </div>
        <Input
          value={extraDesc}
          onChange={(e) => setExtraDesc(e.target.value)}
          placeholder="补充动作细节、风格、运镜要求…（不填则自动推断）"
          style={{ borderRadius: 8 }}
          onPressEnter={handleAnalyze}
        />
      </div>

      {/* 生成按钮 */}
      <Button
        type="primary"
        icon={<VideoCameraOutlined />}
        onClick={handleAnalyze}
        loading={loading}
        disabled={!canGenerate}
        style={{ width: '100%', height: 40, borderRadius: 8, fontWeight: 500 }}
      >
        分析首尾帧生成提示词
      </Button>

      {/* 首帧提示词结果 */}
      {promptStart && (
        <div>
          <div style={{ marginBottom: 6, fontSize: 13, color: 'var(--text-secondary, #9aa0a6)' }}>
            首帧→尾帧 过渡提示词（可编辑）
          </div>
          <Input.TextArea
            value={promptStart}
            onChange={(e) => setPromptStart(e.target.value)}
            autoSize={{ minRows: 3, maxRows: 6 }}
            style={{ borderRadius: 8, color: '#ffffff' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
            <Button
              icon={<CopyOutlined />}
              size="small"
              onClick={() => { navigator.clipboard.writeText(promptStart); message.success('已复制'); }}
            >复制</Button>
            <Button
              type="primary"
              size="small"
              onClick={() => { onApply(promptStart); message.success('已应用到首帧描述'); }}
            >应用到首帧描述</Button>
          </div>
        </div>
      )}

      {/* 尾帧提示词结果 */}
      {promptEnd && (
        <div>
          <div style={{ marginBottom: 6, fontSize: 13, color: 'var(--text-secondary, #9aa0a6)' }}>
            尾帧→首帧 过渡提示词（可编辑）
          </div>
          <Input.TextArea
            value={promptEnd}
            onChange={(e) => setPromptEnd(e.target.value)}
            autoSize={{ minRows: 3, maxRows: 6 }}
            style={{ borderRadius: 8, color: '#ffffff' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
            <Button
              icon={<CopyOutlined />}
              size="small"
              onClick={() => { navigator.clipboard.writeText(promptEnd); message.success('已复制'); }}
            >复制</Button>
            {onApplyEnd && (
              <Button
                type="primary"
                size="small"
                onClick={() => { onApplyEnd(promptEnd); message.success('已应用到尾帧描述'); }}
              >应用到尾帧描述</Button>
            )}
          </div>
        </div>
      )}

      {/* 一键全部应用 */}
      {hasResult && (
        <Button
          block
          onClick={handleApplyAll}
          style={{ borderRadius: 8 }}
        >
          一键全部应用并关闭
        </Button>
      )}
    </Space>
  );
}

// ─────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────
export default function AIPromptModal({ open, onClose, onApply, onApplyEnd, workflowId }: AIPromptModalProps) {
  // 需要显示"图片分析"Tab 的工作流：文生图（可上传参考图分析风格）、图生视频（分析主图生成运镜描述）
  const showImageTab = workflowId === 't2i' || workflowId === 'i2v';
  const isFlf2v = workflowId === 'flf2v';

  const handleClose = () => {
    onClose();
  };

  const textTab = {
    key: 'text',
    label: (
      <span>
        <ThunderboltOutlined />
        文字描述
      </span>
    ),
    children: (
      <TextDescriptionPanel workflowId={workflowId} onApply={onApply} onClose={handleClose} />
    ),
  };

  const imageTab = {
    key: 'image',
    label: (
      <span>
        <PictureOutlined />
        图片分析
      </span>
    ),
    children: (
      <ImageAnalyzePanel onApply={onApply} onClose={handleClose} />
    ),
  };

  const flf2vTab = {
    key: 'flf2v',
    label: (
      <span>
        <VideoCameraOutlined />
        首尾帧分析
      </span>
    ),
    children: (
      <Flf2vFrameAnalyzePanel onApply={onApply} onApplyEnd={onApplyEnd} onClose={handleClose} />
    ),
  };

  let content: React.ReactNode;
  if (isFlf2v) {
    content = <Tabs items={[flf2vTab, textTab]} defaultActiveKey="flf2v" />;
  } else if (showImageTab) {
    content = <Tabs items={[textTab, imageTab]} defaultActiveKey="text" />;
  } else {
    content = <TextDescriptionPanel workflowId={workflowId} onApply={onApply} onClose={handleClose} />;
  }

  return (
    <Modal
      title={
        <Space>
          <ThunderboltOutlined style={{ color: '#faad14' }} />
          <span>AI 生成提示词</span>
        </Space>
      }
      open={open}
      onCancel={handleClose}
      width={600}
      centered
      footer={null}
    >
      {content}
    </Modal>
  );
}
