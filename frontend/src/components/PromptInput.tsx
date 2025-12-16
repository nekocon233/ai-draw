import { Input, Button } from 'antd';
import { ThunderboltOutlined, ClearOutlined } from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import { apiService } from '../api/services';
import { useState } from 'react';
import './PromptInput.css';

const { TextArea } = Input;

export default function PromptInput() {
  const { prompt, loraPrompt, setPrompt, setLoraPrompt, setError } = useAppStore();
  const [generating, setGenerating] = useState(false);
  const [description, setDescription] = useState('');

  const handleGeneratePrompt = async () => {
    if (!description.trim()) {
      setError('请输入描述');
      return;
    }

    setGenerating(true);
    try {
      const res = await apiService.generatePrompt({ description });
      setPrompt(res.prompt);
      setDescription('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleClear = () => {
    setDescription('');
    setPrompt('');
    setLoraPrompt('');
  };

  return (
    <div className="prompt-container">
      <div className="prompt-header">
        <h3 className="prompt-title">提示词编辑</h3>
        <Button
          icon={<ClearOutlined />}
          size="small"
          onClick={handleClear}
        >
          清空全部
        </Button>
      </div>

      <div className="prompt-section">
        <div className="prompt-label-row">
          <span className="prompt-label">中文描述</span>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            size="small"
            loading={generating}
            onClick={handleGeneratePrompt}
            className="ai-generate-btn"
          >
            AI 生成
          </Button>
        </div>
        <TextArea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="输入中文描述,例如:一个美丽的女孩"
          rows={3}
          className="prompt-textarea"
        />
      </div>

      <div className="prompt-section">
        <span className="prompt-label">英文 Prompt</span>
        <TextArea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="AI 生成的英文提示词或手动输入"
          rows={6}
          className="prompt-textarea"
        />
      </div>

      <div className="prompt-section">
        <span className="prompt-label">LoRA Prompt (可选)</span>
        <Input
          value={loraPrompt}
          onChange={(e) => setLoraPrompt(e.target.value)}
          placeholder="例如: <lora:style_name:0.8>"
          style={{ borderRadius: 8 }}
        />
      </div>
    </div>
  );
}
