import { useEffect, useState } from 'react';
import { Button, Input, message, Modal, Tabs, Upload } from 'antd';
import {
  BulbOutlined,
  CopyOutlined,
  DeleteOutlined,
  FormOutlined,
  PictureOutlined,
  UploadOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { apiService } from '../api/services';
import { useAppStore } from '../stores/appStore';
import './PromptAssistantModal.css';

const { TextArea } = Input;

interface PromptAssistantModalProps {
  open: boolean;
  onClose: () => void;
  onApply: (prompt: string) => void;
  onApplyEnd?: (prompt: string) => void;
  workflowId?: string;
  initialPrompt?: string;
}

interface PromptResultProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onApply: () => void;
  applyLabel?: string;
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

function PromptResult({ label, value, onChange, onApply, applyLabel = '应用到输入框' }: PromptResultProps) {
  if (!value) return null;

  return (
    <section className="prompt-assistant-result" aria-label={label}>
      <div className="prompt-assistant-result-head">
        <strong>{label}</strong>
        <span>可以在应用前继续修改</span>
      </div>
      <TextArea
        value={value}
        onChange={event => onChange(event.target.value)}
        autoSize={{ minRows: 4, maxRows: 9 }}
        aria-label={`${label}内容`}
      />
      <div className="prompt-assistant-result-actions">
        <Button
          icon={<CopyOutlined />}
          onClick={() => {
            navigator.clipboard.writeText(value);
            message.success('已复制到剪贴板');
          }}
        >
          复制
        </Button>
        <Button type="primary" onClick={onApply}>{applyLabel}</Button>
      </div>
    </section>
  );
}

function TextPromptPanel({
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

  const generate = async () => {
    if (!description.trim()) {
      message.warning('请先描述想要的画面');
      return;
    }
    setLoading(true);
    try {
      const response = await apiService.generatePrompt({ description: description.trim(), workflow_id: workflowId });
      setGeneratedPrompt(response.prompt);
    } catch (error) {
      message.error(`生成失败：${getErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="prompt-assistant-panel">
      <div className="prompt-assistant-intro">
        <strong>把想法扩写成可直接生成的提示词</strong>
        <span>当前工作流的风格和参数要求会自动应用。</span>
      </div>
      <label className="prompt-assistant-field">
        <span>画面描述</span>
        <TextArea
          value={description}
          onChange={event => setDescription(event.target.value)}
          placeholder="例如：雨夜的未来城市，霓虹灯倒映在街道上，电影感构图"
          autoSize={{ minRows: 4, maxRows: 8 }}
          autoFocus
          onPressEnter={event => {
            if (!event.shiftKey) {
              event.preventDefault();
              generate();
            }
          }}
        />
      </label>
      <div className="prompt-assistant-generate-row">
        <span>Enter 生成，Shift + Enter 换行</span>
        <Button type="primary" icon={<BulbOutlined />} loading={loading} disabled={!description.trim()} onClick={generate}>
          生成提示词
        </Button>
      </div>
      <PromptResult
        label="生成结果"
        value={generatedPrompt}
        onChange={setGeneratedPrompt}
        onApply={() => {
          onApply(generatedPrompt);
          onClose();
        }}
      />
    </div>
  );
}

function ImagePromptPanel({ onApply, onClose }: { onApply: (value: string) => void; onClose: () => void }) {
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [extraDescription, setExtraDescription] = useState('');
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [loading, setLoading] = useState(false);

  const readFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      message.error('请选择图片文件');
      return Upload.LIST_IGNORE;
    }
    if (file.size >= 10 * 1024 * 1024) {
      message.error('图片大小不能超过 10MB');
      return Upload.LIST_IGNORE;
    }
    const reader = new FileReader();
    reader.onload = event => {
      setImageDataUrl(String(event.target?.result ?? ''));
      setGeneratedPrompt('');
    };
    reader.readAsDataURL(file);
    return false;
  };

  const analyze = async () => {
    if (!imageDataUrl || !extraDescription.trim()) return;
    setLoading(true);
    try {
      const response = await apiService.analyzeImageForPrompt({
        image: imageDataUrl,
        description: extraDescription.trim(),
      });
      setGeneratedPrompt(response.prompt);
    } catch (error) {
      message.error(`分析失败：${getErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="prompt-assistant-panel">
      <div className="prompt-assistant-intro">
        <strong>从参考图提取构图、动作和风格</strong>
        <span>上传一张图片，并指定希望重点描述的内容。</span>
      </div>
      {imageDataUrl ? (
        <div className="prompt-assistant-image-preview">
          <img src={imageDataUrl} alt="待分析参考图" />
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={() => {
              setImageDataUrl(null);
              setGeneratedPrompt('');
            }}
          >
            移除
          </Button>
        </div>
      ) : (
        <Upload.Dragger
          className="prompt-assistant-upload"
          accept="image/*"
          showUploadList={false}
          beforeUpload={readFile}
        >
          <UploadOutlined />
          <strong>上传参考图片</strong>
          <span>支持 JPG、PNG、WEBP，最大 10MB</span>
        </Upload.Dragger>
      )}
      <label className="prompt-assistant-field">
        <span>分析重点</span>
        <Input
          value={extraDescription}
          onChange={event => setExtraDescription(event.target.value)}
          placeholder="例如：描述人物动作、镜头构图和光影风格"
          onPressEnter={analyze}
        />
      </label>
      <div className="prompt-assistant-generate-row">
        <span>图片只用于本次提示词分析</span>
        <Button type="primary" icon={<PictureOutlined />} loading={loading} disabled={!imageDataUrl || !extraDescription.trim()} onClick={analyze}>
          分析图片
        </Button>
      </div>
      <PromptResult
        label="分析结果"
        value={generatedPrompt}
        onChange={setGeneratedPrompt}
        onApply={() => {
          onApply(generatedPrompt);
          onClose();
        }}
      />
    </div>
  );
}

function FramePromptPanel({
  onApply,
  onApplyEnd,
  onClose,
}: {
  onApply: (value: string) => void;
  onApplyEnd?: (value: string) => void;
  onClose: () => void;
}) {
  const referenceImage = useAppStore(state => state.referenceImage);
  const referenceImageEnd = useAppStore(state => state.referenceImageEnd);
  const isLoop = useAppStore(state => state.isLoop);
  const [extraDescription, setExtraDescription] = useState('');
  const [promptStart, setPromptStart] = useState('');
  const [promptEnd, setPromptEnd] = useState('');
  const [loading, setLoading] = useState(false);
  const canGenerate = Boolean(referenceImage || referenceImageEnd);

  const analyze = async () => {
    if (!canGenerate) return;
    setLoading(true);
    try {
      const response = await apiService.analyzeFramesForPrompt({
        image_start: referenceImage || undefined,
        image_end: referenceImageEnd || undefined,
        description: extraDescription.trim() || undefined,
        is_loop: isLoop,
      });
      setPromptStart(response.prompt_start);
      setPromptEnd(response.prompt_end);
    } catch (error) {
      message.error(`生成失败：${getErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="prompt-assistant-panel">
      <div className="prompt-assistant-intro">
        <strong>根据首尾帧生成过渡描述</strong>
        <span>{isLoop ? '循环模式下会分别描述两个过渡方向。' : '助手会结合已上传的首帧和尾帧。'}</span>
      </div>
      <div className="prompt-assistant-frame-grid">
        {[
          { label: '首帧', src: referenceImage },
          { label: '尾帧', src: referenceImageEnd },
        ].map(frame => (
          <div key={frame.label}>
            <span>{frame.label}</span>
            {frame.src ? <img src={frame.src} alt={frame.label} /> : <div className="prompt-assistant-frame-empty"><PictureOutlined /><span>未上传</span></div>}
          </div>
        ))}
      </div>
      <label className="prompt-assistant-field">
        <span>补充要求（可选）</span>
        <Input
          value={extraDescription}
          onChange={event => setExtraDescription(event.target.value)}
          placeholder="补充动作细节、风格或运镜要求"
          onPressEnter={analyze}
        />
      </label>
      <div className="prompt-assistant-generate-row">
        <span>{canGenerate ? '使用当前输入区中的首尾帧' : '请先在输入区上传至少一帧'}</span>
        <Button type="primary" icon={<VideoCameraOutlined />} loading={loading} disabled={!canGenerate} onClick={analyze}>
          分析首尾帧
        </Button>
      </div>
      <PromptResult
        label="首帧到尾帧"
        value={promptStart}
        onChange={setPromptStart}
        applyLabel="应用到首帧描述"
        onApply={() => onApply(promptStart)}
      />
      <PromptResult
        label="尾帧到首帧"
        value={promptEnd}
        onChange={setPromptEnd}
        applyLabel="应用到尾帧描述"
        onApply={() => onApplyEnd?.(promptEnd)}
      />
      {(promptStart || promptEnd) && (
        <div className="prompt-assistant-apply-all">
          <Button onClick={() => {
            if (promptStart) onApply(promptStart);
            if (promptEnd) onApplyEnd?.(promptEnd);
            onClose();
          }}>
            全部应用并关闭
          </Button>
        </div>
      )}
    </div>
  );
}

function PosePromptPanel({ onApply, onClose }: { onApply: (value: string) => void; onClose: () => void }) {
  const [preset, setPreset] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    apiService.getPosePreset()
      .then(response => {
        if (active) setPreset(response.prompt);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  return (
    <div className="prompt-assistant-panel">
      <div className="prompt-assistant-intro">
        <strong>从预设快速开始</strong>
        <span>预设会持续扩充，应用后仍可在输入框中继续修改。</span>
      </div>
      <section className="prompt-assistant-preset-card">
        <div className="prompt-assistant-preset-heading">
          <FormOutlined />
          <div>
            <strong>参考姿势</strong>
            <span>让参考图 1 中的角色跟随参考图 2 的动作</span>
          </div>
        </div>
        <div className="prompt-assistant-pose-map">
          <div><b>参考图 1</b><span>角色、画风与背景</span></div>
          <div><b>参考图 2</b><span>动作与身体姿态</span></div>
        </div>
        <div className="prompt-assistant-preset-copy">
          <div className="prompt-assistant-result-head">
            <strong>预设内容</strong>
            <span>{loading ? '正在加载' : failed ? '加载失败' : '由服务端统一维护'}</span>
          </div>
          <p>{loading ? '正在获取姿势提示预设…' : failed ? '暂时无法获取预设，请稍后重试。' : preset}</p>
        </div>
        <div className="prompt-assistant-preset-actions">
          <span>推荐在支持多张参考图的工作流中使用</span>
          <Button
            type="primary"
            icon={<FormOutlined />}
            disabled={!preset || loading || failed}
            onClick={() => {
              onApply(preset);
              onClose();
            }}
          >
            填充参考姿势提示词
          </Button>
        </div>
      </section>
    </div>
  );
}

export default function PromptAssistantModal({
  open,
  onClose,
  onApply,
  onApplyEnd,
  workflowId,
  initialPrompt,
}: PromptAssistantModalProps) {
  const showImageAnalysis = workflowId === 't2i' || workflowId === 'i2v';
  const showFrameAnalysis = workflowId === 'flf2v';
  const items = [
    {
      key: 'text',
      label: <span><BulbOutlined />文字扩写</span>,
      children: <TextPromptPanel workflowId={workflowId} initialPrompt={initialPrompt} onApply={onApply} onClose={onClose} />,
    },
    ...(showImageAnalysis ? [{
      key: 'image',
      label: <span><PictureOutlined />图片分析</span>,
      children: <ImagePromptPanel onApply={onApply} onClose={onClose} />,
    }] : []),
    ...(showFrameAnalysis ? [{
      key: 'frames',
      label: <span><VideoCameraOutlined />首尾帧</span>,
      children: <FramePromptPanel onApply={onApply} onApplyEnd={onApplyEnd} onClose={onClose} />,
    }] : []),
    {
      key: 'presets',
      label: <span><FormOutlined />预设</span>,
      children: <PosePromptPanel onApply={onApply} onClose={onClose} />,
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={760}
      centered
      rootClassName="prompt-assistant-modal-root"
      className="prompt-assistant-modal"
      title={(
        <div className="prompt-assistant-title">
          <BulbOutlined />
          <div>
            <strong>提示词助手</strong>
            <span>扩写描述、分析参考图并生成可编辑提示词</span>
          </div>
        </div>
      )}
    >
      <Tabs
        className="prompt-assistant-tabs"
        defaultActiveKey={showFrameAnalysis ? 'frames' : 'text'}
        items={items}
      />
    </Modal>
  );
}
