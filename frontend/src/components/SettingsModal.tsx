import { useEffect, useRef } from 'react';
import { Modal, Form, Slider, InputNumber, Input, Row, Col, Switch, Select } from 'antd';
import { useAppStore, buildWorkflowTransition, type GenerationSettingsDraft } from '../stores/appStore';
import { useShallow } from 'zustand/react/shallow';
import type { WorkflowParameterValue } from '../types/api';
import { getWorkflowOptions, getWorkflowMethods } from '../utils/workflowOptions';
import { clampLoraPromptStrengths, getLoraPromptError } from '../utils/loraOptions';
import LoraSelector from './LoraSelector';
import './SettingsModal.css';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

interface SettingsFormValues extends GenerationSettingsDraft {
  selectOptions: Record<string, WorkflowParameterValue>;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const {
    currentWorkflow,
    availableWorkflows,
    strength,
    count,
    loraPrompt,
    width,
    height,
    useOriginalSize,
    selectOptions,
    commitGenerationSettings,
  } = useAppStore(useShallow(state => ({
    currentWorkflow: state.currentWorkflow,
    availableWorkflows: state.availableWorkflows,
    strength: state.strength,
    count: state.count,
    loraPrompt: state.loraPrompt,
    width: state.width,
    height: state.height,
    useOriginalSize: state.useOriginalSize,
    selectOptions: state.selectOptions,
    commitGenerationSettings: state.commitGenerationSettings,
  })));

  const [form] = Form.useForm<SettingsFormValues>();
  const draftWorkflow = Form.useWatch('workflow', form) ?? currentWorkflow;
  const draftUseOriginalSize = Form.useWatch('useOriginalSize', form) ?? useOriginalSize;

  // 参数面板由弹窗草稿驱动，切换方式不会提前修改全局状态。
  const workflowMeta = availableWorkflows.find(w => w.key === draftWorkflow);
  // 同类工作流分组（如 图生图）：用于在设置里选择具体方式
  const category = workflowMeta?.category;
  const methodOptions = category
    ? getWorkflowMethods(availableWorkflows.filter(w => w.category === category), draftWorkflow)
    : [];
  const hasStrength = workflowMeta?.parameters.some(p => p.name === 'strength') || false;
  const hasCount = workflowMeta?.parameters.some(p => p.name === 'count') || false;
  const hasLoraPrompt = workflowMeta?.parameters.some(p => p.name === 'lora_prompt') || false;
  const hasWidth = workflowMeta?.parameters.some(p => p.name === 'width') || false;
  const hasHeight = workflowMeta?.parameters.some(p => p.name === 'height') || false;
  const supportsOriginalSize = workflowMeta?.supports_original_size === true;
  // select 类型参数（如视频时长）也纳入表单草稿。
  const selectParams = workflowMeta?.parameters.filter(p => p.type === 'select') ?? [];

  // 获取 width 和 height 的参数配置
  const strengthParam = workflowMeta?.parameters.find(p => p.name === 'strength');
  const countParam = workflowMeta?.parameters.find(p => p.name === 'count');
  const widthParam = workflowMeta?.parameters.find(p => p.name === 'width');
  const heightParam = workflowMeta?.parameters.find(p => p.name === 'height');

  // 每次打开弹窗时，从当前已提交状态创建一份完整草稿。
  useEffect(() => {
    if (open) {
      const currentMeta = availableWorkflows.find(w => w.key === currentWorkflow);
      const parameter = (name: string) => currentMeta?.parameters.find(item => item.name === name);
      form.setFieldsValue({
        workflow: currentWorkflow,
        strength,
        count,
        loraPrompt: clampLoraPromptStrengths(loraPrompt),
        width: width ?? Number(parameter('width')?.default ?? 1024),
        height: height ?? Number(parameter('height')?.default ?? 1024),
        useOriginalSize,
        selectOptions: {
          ...selectOptions,
          ...getWorkflowOptions(currentMeta, selectOptions),
        },
      });
    }
  }, [open, form, currentWorkflow, availableWorkflows, strength, count, loraPrompt, width, height, useOriginalSize, selectOptions]);

  const handleDraftWorkflowChange = (workflow: string) => {
    const preview = buildWorkflowTransition(useAppStore.getState(), workflow);
    workflow = preview.currentWorkflow ?? workflow;
    const targetMeta = availableWorkflows.find(item => item.key === workflow);
    if (!targetMeta) return;
    const parameter = (name: string) => targetMeta.parameters.find(item => item.name === name);
    const nextSelectOptions = { ...(form.getFieldValue('selectOptions') ?? selectOptions) };
    targetMeta.parameters.forEach(param => {
      if (param.type !== 'select') return;
      const current = nextSelectOptions[param.name];
      if (current === undefined || (param.options && !param.options.includes(String(current)))) {
        nextSelectOptions[param.name] = param.default;
      }
    });

    form.setFieldsValue({
      workflow,
      strength: Number(parameter('strength')?.default ?? strength),
      count: Number(parameter('count')?.default ?? count),
      loraPrompt: clampLoraPromptStrengths(preview.loraPrompt ?? String(parameter('lora_prompt')?.default ?? '')),
      width: preview.width ?? (parameter('width') ? Number(parameter('width')?.default) : null),
      height: preview.height ?? (parameter('height') ? Number(parameter('height')?.default) : null),
      useOriginalSize: preview.useOriginalSize ?? true,
      selectOptions: nextSelectOptions,
    });
  };

  const handleOk = async () => {
    let values: SettingsFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // Field errors stay in the modal; do not reject the click handler.
    }
    commitGenerationSettings({
      ...values,
      loraPrompt: clampLoraPromptStrengths(values.loraPrompt || ''),
      width: hasWidth ? values.width : null,
      height: hasHeight ? values.height : null,
      selectOptions: values.selectOptions ?? {},
    });
    onClose();
  };

  const panelRef = useRef<HTMLDivElement>(null);
  const pressStartedInPanelRef = useRef(false);
  const recordPressOrigin = (event: React.MouseEvent) => {
    pressStartedInPanelRef.current = event.target instanceof Node && Boolean(panelRef.current?.contains(event.target));
  };

  // Slider drags stop mousedown propagation, so the dialog cannot tell that a drag released over
  // the mask began inside it and treats the release as a mask click. Ordinary mask clicks still close.
  const handleCancel = (event: React.SyntheticEvent) => {
    const target = event.target instanceof Node ? event.target : null;
    if (event.type === 'click' && pressStartedInPanelRef.current && target && !panelRef.current?.contains(target)) return;
    onClose();
  };

  return (
    <Modal
      title="生成设置"
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      panelRef={panelRef}
      wrapProps={{ onMouseDownCapture: recordPressOrigin }}
      width={500}
      centered
      rootClassName="settings-modal-root"
      className="settings-modal"
      okText="确定"
      cancelText="取消"
      destroyOnClose
      styles={{ body: { maxHeight: 'min(70dvh, 680px)', overflowY: 'auto', overflowX: 'hidden' } }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          strength: strength,
          count: count,
          loraPrompt: clampLoraPromptStrengths(loraPrompt),
        }}
      >
        {methodOptions.length === 0 && (
          <Form.Item name="workflow" hidden>
            <Input />
          </Form.Item>
        )}
        {!supportsOriginalSize && (
          <Form.Item name="useOriginalSize" valuePropName="checked" hidden>
            <Switch />
          </Form.Item>
        )}

        {methodOptions.length > 0 && (
          <Form.Item label="生成方式" name="workflow" extra={workflowMeta?.description}>
            <Select
              onChange={handleDraftWorkflowChange}
              options={methodOptions.map(m => ({
                label: m.method || m.label,
                value: m.key,
              }))}
              style={{ width: '100%' }}
            />
          </Form.Item>
        )}

        {selectParams.map(param => (
          <Form.Item
            key={param.name}
            label={param.label}
            name={['selectOptions', param.name]}
            extra={param.name === 'h3_aspect_ratio' ? '自动时跟随关键帧比例；纯文本生成使用 16:9' : undefined}
          >
            <Select
              options={(param.options || []).map(v => ({
                label: param.option_labels?.[v] ?? (param.name === 'h3_aspect_ratio' && v === 'auto' ? '自动（跟随关键帧）' : v),
                value: v,
              }))}
              style={{ width: '100%' }}
            />
          </Form.Item>
        ))}

        {hasStrength && (
          <Form.Item label="生成强度">
            <Row className="settings-control-row" align="middle">
              <Col flex="auto">
                <Form.Item name="strength" noStyle>
                  <Slider
                    aria-label="生成强度"
                    min={strengthParam?.min ?? 0}
                    max={strengthParam?.max ?? 1}
                    step={strengthParam?.step ?? 0.01}
                    marks={{ 0: '0', 0.5: '0.5', 1: '1' }}
                  />
                </Form.Item>
              </Col>
              <Col>
                <Form.Item name="strength" noStyle>
                  <InputNumber
                    aria-label="生成强度数值"
                    min={strengthParam?.min ?? 0}
                    max={strengthParam?.max ?? 1}
                    step={strengthParam?.step ?? 0.01}
                    size="small"
                    style={{ width: 70 }}
                  />
                </Form.Item>
              </Col>
            </Row>
          </Form.Item>
        )}

        {hasCount && (
          <Form.Item label="生成数量">
            <Row className="settings-control-row" align="middle">
              <Col flex="auto">
                <Form.Item name="count" noStyle>
                  <Slider
                    ariaLabelForHandle="生成数量"
                    min={countParam?.min ?? 1}
                    max={countParam?.max ?? 8}
                    step={countParam?.step ?? 1}
                    marks={Object.fromEntries([1, 2, 4, 6, 8]
                      .filter(value => value >= (countParam?.min ?? 1) && value <= (countParam?.max ?? 8))
                      .map(value => [value, String(value)]))}
                  />
                </Form.Item>
              </Col>
            </Row>
          </Form.Item>
        )}

        {hasLoraPrompt && (
          <Form.Item label="风格 LoRA" name="loraPrompt"
            rules={[{ validator: (_, value: string | undefined) => {
              const error = getLoraPromptError(value ?? '');
              return error ? Promise.reject(new Error(error)) : Promise.resolve();
            } }]}
          >
            <LoraSelector key={draftWorkflow} workflow={draftWorkflow} />
          </Form.Item>
        )}

        {hasWidth && (
          <Form.Item label={widthParam?.label || "图像宽度"}>
            {supportsOriginalSize && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13 }}>使用原图尺寸</span>
                <Form.Item name="useOriginalSize" valuePropName="checked" noStyle>
                  <Switch size="small" aria-label="使用原图尺寸" />
                </Form.Item>
              </div>
            )}
            {(!draftUseOriginalSize || !supportsOriginalSize) && (
              <Row className="settings-control-row" align="middle">
                <Col flex="auto">
                  <Form.Item name="width" noStyle>
                    <Slider
                      aria-label={widthParam?.label || '图像宽度'}
                      min={widthParam?.min || 512}
                      max={widthParam?.max || 2048}
                      step={widthParam?.step || 64}
                    />
                  </Form.Item>
                </Col>
                <Col>
                  <Form.Item name="width" noStyle>
                    <InputNumber
                      aria-label={`${widthParam?.label || '图像宽度'}数值`}
                      min={widthParam?.min || 512}
                      max={widthParam?.max || 2048}
                      step={widthParam?.step || 64}
                      size="small"
                      style={{ width: 80 }}
                    />
                  </Form.Item>
                </Col>
              </Row>
            )}
          </Form.Item>
        )}

        {hasHeight && (!draftUseOriginalSize || !supportsOriginalSize) && (
          <Form.Item label={heightParam?.label || "图像高度"}>
            <Row className="settings-control-row" align="middle">
              <Col flex="auto">
                <Form.Item name="height" noStyle>
                  <Slider
                    aria-label={heightParam?.label || '图像高度'}
                    min={heightParam?.min || 512}
                    max={heightParam?.max || 2048}
                    step={heightParam?.step || 64}
                  />
                </Form.Item>
              </Col>
              <Col>
                <Form.Item name="height" noStyle>
                  <InputNumber
                    aria-label={`${heightParam?.label || '图像高度'}数值`}
                    min={heightParam?.min || 512}
                    max={heightParam?.max || 2048}
                    step={heightParam?.step || 64}
                    size="small"
                    style={{ width: 80 }}
                  />
                </Form.Item>
              </Col>
            </Row>
          </Form.Item>
        )}

      </Form>
    </Modal>
  );
}
