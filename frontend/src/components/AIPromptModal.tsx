import { useState } from 'react';
import { Modal, Input, Button, Space, message, Tabs, Upload } from 'antd';
import {
  ThunderboltOutlined,
  CopyOutlined,
  PictureOutlined,
  DeleteOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { apiService } from '../api/services';

const { TextArea } = Input;

interface AIPromptModalProps {
  open: boolean;
  onClose: () => void;
  onApply: (prompt: string) => void;
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
// 主组件
// ─────────────────────────────────────────────
export default function AIPromptModal({ open, onClose, onApply, workflowId }: AIPromptModalProps) {
  const isT2i = workflowId === 't2i';

  const handleClose = () => {
    onClose();
  };

  const tabItems = [
    {
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
    },
    {
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
    },
  ];

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
      {isT2i ? (
        <Tabs items={tabItems} defaultActiveKey="text" />
      ) : (
        <TextDescriptionPanel workflowId={workflowId} onApply={onApply} onClose={handleClose} />
      )}
    </Modal>
  );
}
