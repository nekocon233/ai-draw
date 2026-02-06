import { useState } from 'react';
import { Modal, Input, Button, Space, App } from 'antd';
import { ThunderboltOutlined, CopyOutlined } from '@ant-design/icons';
import { apiService } from '../api/services';

const { TextArea } = Input;

interface AIPromptModalProps {
  open: boolean;
  onClose: () => void;
  onApply: (prompt: string) => void;
}

export default function AIPromptModal({ open, onClose, onApply }: AIPromptModalProps) {
  const { message } = App.useApp();
  const [description, setDescription] = useState('');
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    if (!description.trim()) {
      message.warning('请输入中文描述');
      return;
    }

    setLoading(true);
    try {
      const res = await apiService.generatePrompt({ description });
      setGeneratedPrompt(res.prompt);
      message.success('Prompt 生成成功');
    } catch (err: any) {
      message.error('生成失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedPrompt);
    message.success('已复制到剪贴板');
  };

  const handleApply = () => {
    if (!generatedPrompt.trim()) {
      message.warning('请先生成 Prompt');
      return;
    }
    onApply(generatedPrompt);
    handleClose();
  };

  const handleClose = () => {
    setDescription('');
    setGeneratedPrompt('');
    onClose();
  };

  return (
    <Modal
      title={
        <Space>
          <ThunderboltOutlined style={{ color: '#faad14' }} />
          <span>AI 生成英文 Prompt</span>
        </Space>
      }
      open={open}
      onCancel={handleClose}
      width={600}
      centered
      footer={[
        <Button key="cancel" onClick={handleClose}>
          取消
        </Button>,
        <Button
          key="copy"
          icon={<CopyOutlined />}
          onClick={handleCopy}
          disabled={!generatedPrompt}
        >
          复制
        </Button>,
        <Button
          key="apply"
          type="primary"
          onClick={handleApply}
          disabled={!generatedPrompt}
        >
          应用到输入框
        </Button>,
      ]}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <div>
          <div style={{ 
            marginBottom: 8, 
            fontWeight: 500,
            color: 'var(--text-primary, #202124)'
          }}>
            中文描述
          </div>
          <TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="用中文描述你想要生成的图片，例如：一只可爱的小猫在草地上玩耍"
            autoSize={{ minRows: 3, maxRows: 6 }}
            autoFocus
            style={{
              borderRadius: '8px'
            }}
          />
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={handleGenerate}
            loading={loading}
            disabled={!description.trim()}
            style={{ 
              marginTop: 12, 
              width: '100%',
              height: '40px',
              borderRadius: '8px',
              fontWeight: 500
            }}
          >
            生成英文 Prompt
          </Button>
        </div>

        {generatedPrompt && (
          <div>
            <TextArea
              value={generatedPrompt}
              onChange={(e) => setGeneratedPrompt(e.target.value)}
              autoSize={{ minRows: 4, maxRows: 8 }}
              style={{ 
                borderRadius: '8px',
                color: '#ffffff'
              }}
            />
          </div>
        )}
      </Space>
    </Modal>
  );
}
