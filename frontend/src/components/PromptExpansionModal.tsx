import { useEffect, useId, useRef, useState } from 'react';
import { Button, Input, message, Modal } from 'antd';
import {
  BulbOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import { apiService } from '../api/services';
import { useAppStore } from '../stores/appStore';
import { getImageMentionError, getPresetWorkflowBlocker, supportsImageMentions } from '../utils/imageMentions';
import { readExpansionDraft, writeExpansionDraft } from '../utils/promptExpansionDrafts';
import './PromptExpansionModal.css';

const { TextArea } = Input;

interface PromptExpansionModalProps {
  open: boolean;
  onClose: () => void;
  onApply: (prompt: string) => void;
  workflowId?: string;
  /** 输入框当前内容：只在本会话还没有扩写草稿时作为原始描述的起点 */
  inputPrompt?: string;
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
  inputPrompt = '',
  onApply,
  onClose,
}: {
  workflowId?: string;
  inputPrompt?: string;
  onApply: (value: string) => void;
  onClose: () => void;
}) {
  const sessionId = useAppStore(state => state.currentSessionId) ?? 'new';
  const sourceId = useId();
  // 已保存的原始描述不会被输入框（常为已应用的扩写结果）覆盖，需要时手动点按钮替换
  const [savedDraft] = useState(() => readExpansionDraft(sessionId));
  const [description, setDescription] = useState(savedDraft?.source ?? inputPrompt);
  const [generatedPrompt, setGeneratedPrompt] = useState(savedDraft?.result ?? '');
  const [loading, setLoading] = useState(false);
  // 只保存在弹窗里实际操作过的内容，单纯预填的输入框文字不留下草稿
  const persisting = useRef(savedDraft !== null);
  const canImportInput = inputPrompt.trim() !== '' && inputPrompt.trim() !== description.trim();

  useEffect(() => {
    if (persisting.current) writeExpansionDraft(sessionId, description, generatedPrompt);
  }, [sessionId, description, generatedPrompt]);

  const editDescription = (value: string) => {
    persisting.current = true;
    setDescription(value);
  };

  const editResult = (value: string) => {
    persisting.current = true;
    setGeneratedPrompt(value);
  };
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
      editResult(response.prompt);
    } catch (error) {
      message.error(`扩写失败：${getErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="prompt-expansion-panel">
      <div className="prompt-expansion-field">
        <div className="prompt-expansion-field-head">
          <label htmlFor={sourceId}>原始描述</label>
          {canImportInput && (
            <Button type="link" size="small" title={inputPrompt} onClick={() => editDescription(inputPrompt)}>
              {description.trim() ? '用输入框内容覆盖' : '填入输入框内容'}
            </Button>
          )}
        </div>
        <TextArea
          id={sourceId}
          value={description}
          onChange={event => editDescription(event.target.value)}
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
      </div>
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
        onChange={editResult}
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
  inputPrompt,
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
      <PromptExpansionPanel workflowId={workflowId} inputPrompt={inputPrompt} onApply={onApply} onClose={onClose} />
    </Modal>
  );
}
