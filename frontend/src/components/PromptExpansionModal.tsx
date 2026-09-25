import { useState } from 'react';
import { Button, Input, message, Modal } from 'antd';
import {
  BulbOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import { apiService } from '../api/services';
import { useAppStore } from '../stores/appStore';
import { getImageMentionError, getPresetWorkflowBlocker, supportsImageMentions } from '../utils/imageMentions';
import './PromptExpansionModal.css';

const { TextArea } = Input;

interface PromptExpansionModalProps {
  open: boolean;
  onClose: () => void;
  onApply: (prompt: string) => void;
  workflowId?: string;
  initialPrompt?: string;
}

interface PromptResultProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onApply: () => void;
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

function PromptResult({ label, value, onChange, onApply }: PromptResultProps) {
  if (!value) return null;

  return (
    <section className="prompt-expansion-result" aria-label={label}>
      <div className="prompt-expansion-result-head">
        <strong>{label}</strong>
        <span>可以在应用前继续修改</span>
      </div>
      <TextArea
        value={value}
        onChange={event => onChange(event.target.value)}
        autoSize={{ minRows: 4, maxRows: 9 }}
        aria-label={`${label}内容`}
      />
      <div className="prompt-expansion-result-actions">
        <Button
          icon={<CopyOutlined aria-hidden="true" />}
          onClick={() => {
            navigator.clipboard.writeText(value);
            message.success('已复制到剪贴板');
          }}
        >
          复制
        </Button>
        <Button type="primary" onClick={onApply}>应用到输入框</Button>
      </div>
    </section>
  );
}

function PromptExpansionPanel({
  workflowId,
  initialPrompt,
  onApply,
  onClose,
}: {
  workflowId?: string;
  initialPrompt?: string;
  onApply: (value: string) => void;
  onClose: () => void;
}) {
  const [description, setDescription] = useState(initialPrompt ?? '');
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const promptPreset = useAppStore(state => state.promptPreset);
  const workflowMeta = useAppStore(state => state.availableWorkflows.find(item => item.key === workflowId));
  // 适用的预设只作为只读上下文：扩写只改写描述，生成时后端再拼接一次预设
  const contextPreset = promptPreset && !getPresetWorkflowBlocker(promptPreset, workflowMeta) ? promptPreset : null;

  const validateReferences = (content: string) => {
    const state = useAppStore.getState();
    const metadata = state.availableWorkflows.find(item => item.key === workflowId);
    const error = supportsImageMentions(metadata)
      ? getImageMentionError(content, [state.referenceImage, state.referenceImage2, state.referenceImage3]) : null;
    if (error) message.warning(error);
    return !error;
  };

  const generate = async () => {
    if (loading) return;
    if (!description.trim()) {
      message.warning('请先描述想要的画面');
      return;
    }
    if (!validateReferences(description)) return;
    setLoading(true);
    try {
      const response = await apiService.generatePrompt({
        description: description.trim(),
        workflow_id: workflowId,
        preset_prompt: contextPreset?.prompt,
      });
      setGeneratedPrompt(response.prompt);
    } catch (error) {
      message.error(`扩写失败：${getErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="prompt-expansion-panel">
      <label className="prompt-expansion-field">
        <span>原始描述</span>
        <TextArea
          value={description}
          onChange={event => setDescription(event.target.value)}
          placeholder="简要描述想要的画面、动作或要求…"
          autoSize={{ minRows: 4, maxRows: 8 }}
          autoFocus
          onPressEnter={event => {
            if (!event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              generate();
            }
          }}
        />
      </label>
      <div className="prompt-expansion-generate-row">
        <span>
          {contextPreset ? `预设「${contextPreset.title}」生成时自动添加，不参与扩写；` : ''}
          Enter 扩写，Shift + Enter 换行
        </span>
        <Button type="primary" icon={<BulbOutlined aria-hidden="true" />} loading={loading} disabled={!description.trim()} onClick={generate}>
          开始扩写
        </Button>
      </div>
      <PromptResult
        label="扩写结果"
        value={generatedPrompt}
        onChange={setGeneratedPrompt}
        onApply={() => {
          if (!validateReferences(generatedPrompt)) return;
          onApply(generatedPrompt);
          onClose();
        }}
      />
    </div>
  );
}

export default function PromptExpansionModal({
  open,
  onClose,
  onApply,
  workflowId,
  initialPrompt,
}: PromptExpansionModalProps) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={760}
      centered
      rootClassName="prompt-expansion-modal-root"
      className="prompt-expansion-modal"
      title={(
        <div className="prompt-expansion-title">
          <BulbOutlined aria-hidden="true" />
          <div>
            <strong>扩写助手</strong>
            <span>把简短描述扩写为详细提示词</span>
          </div>
        </div>
      )}
    >
      <PromptExpansionPanel workflowId={workflowId} initialPrompt={initialPrompt} onApply={onApply} onClose={onClose} />
    </Modal>
  );
}
