import { Button, App } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import { apiService } from '../api/services';
import './GenerateButton.css';

export default function GenerateButton() {
  const { message } = App.useApp();
  const {
    prompt,
    currentWorkflow,
    strength,
    count,
    loraPrompt,
    referenceImage,
    isGenerating,
    setError,
    clearError,
    addChatMessage,
  } = useAppStore();

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      message.warning('请先输入提示词');
      return;
    }

    clearError();

    // 添加用户消息到聊天历史（包含加载占位符）
    // 使用用户选择的工作流
    await addChatMessage(prompt, currentWorkflow, strength, count, loraPrompt);

    try {
      const res = await apiService.generateImage({
        prompt,
        workflow: currentWorkflow,
        strength,
        count,
        lora_prompt: loraPrompt || undefined,
        reference_image: referenceImage || undefined,
        width: useAppStore.getState().width || undefined,
        height: useAppStore.getState().height || undefined,
      });

      // 图片通过 WebSocket 实时推送，生成完成时自动保存
      message.success(`成功生成 ${res.count} 张图片!`);
    } catch (err: any) {
      setError(err.message);
      message.error('生成失败: ' + err.message);
    }
  };

  return (
    <div className="generate-button-container">
      <div className="generate-button-wrapper">
        <Button
          type="primary"
          size="large"
          icon={<ThunderboltOutlined />}
          onClick={handleGenerate}
          loading={isGenerating}
          disabled={isGenerating}
          block
          className="generate-main-button"
        >
          {isGenerating ? '生成中...' : '开始生成'}
        </Button>
        
        {isGenerating && (
          <div className="generate-status">
            正在生成图片，请稍候...
          </div>
        )}
      </div>
    </div>
  );
}
