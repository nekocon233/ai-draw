import { Button, App } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import { apiService } from '../api/services';
import { wsManager } from '../api/websocket';
import './GenerateButton.css';

export default function GenerateButton() {
  const { message } = App.useApp();
  const {
    prompt,
    currentWorkflow,
    availableWorkflows,
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

    const currentWorkflowMeta = availableWorkflows.find(w => w.key === currentWorkflow);
    if (currentWorkflowMeta?.requires_image && !referenceImage) {
      message.warning(`当前工作流“${currentWorkflowMeta.label}”需要先上传参考图`);
      return;
    }

    clearError();

    // 添加用户消息到聊天历史（包含加载占位符）
    // 使用用户选择的工作流
    const messageId = await addChatMessage(prompt, currentWorkflow, strength, count, loraPrompt);

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
      if (!wsManager.isConnected) {
        useAppStore.getState().updateChatImages(messageId, res.images);
      }
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
