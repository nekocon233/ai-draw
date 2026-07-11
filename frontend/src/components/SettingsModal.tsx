import { useEffect } from 'react';
import { Modal, Form, Slider, InputNumber, Input, Row, Col, Switch, Select } from 'antd';
import { useAppStore, type GenerationSettingsDraft } from '../stores/appStore';
import type { WorkflowParameterValue } from '../types/api';
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
    startFrameCount,
    endFrameCount,
    frameRate,
    frameCount,
    selectOptions,
    commitGenerationSettings,
  } = useAppStore();

  const [form] = Form.useForm<SettingsFormValues>();
  const draftWorkflow = Form.useWatch('workflow', form) ?? currentWorkflow;
  const draftUseOriginalSize = Form.useWatch('useOriginalSize', form) ?? useOriginalSize;

  // 参数面板由弹窗草稿驱动，切换方式不会提前修改全局状态。
  const workflowMeta = availableWorkflows.find(w => w.key === draftWorkflow);
  // 同类工作流分组（如 图生图）：用于在设置里选择具体方式
  const category = workflowMeta?.category;
  const methodOptions = category
    ? availableWorkflows.filter(w => w.category === category)
    : [];
  const hasStrength = workflowMeta?.parameters.some(p => p.name === 'strength') || false;
  const hasCount = workflowMeta?.parameters.some(p => p.name === 'count') || false;
  const hasLoraPrompt = workflowMeta?.parameters.some(p => p.name === 'lora_prompt') || false;
  const hasWidth = workflowMeta?.parameters.some(p => p.name === 'width') || false;
  const hasHeight = workflowMeta?.parameters.some(p => p.name === 'height') || false;
  const hasStartFrameCount = workflowMeta?.parameters.some(p => p.name === 'startFrameCount') || false;
  const hasEndFrameCount = workflowMeta?.parameters.some(p => p.name === 'endFrameCount') || false;
  const hasFrameRate = workflowMeta?.parameters.some(p => p.name === 'frameRate') || false;
  const hasFrameCount = workflowMeta?.parameters.some(p => p.name === 'frameCount') || false;
  const supportsOriginalSize = workflowMeta?.supports_original_size === true;
  // select 类型参数（如 Kling 时长）也纳入表单草稿。
  const selectParams = workflowMeta?.parameters.filter(p => p.type === 'select') ?? [];

  // 获取 width 和 height 的参数配置
  const strengthParam = workflowMeta?.parameters.find(p => p.name === 'strength');
  const countParam = workflowMeta?.parameters.find(p => p.name === 'count');
  const widthParam = workflowMeta?.parameters.find(p => p.name === 'width');
  const heightParam = workflowMeta?.parameters.find(p => p.name === 'height');
  const startFrameCountParam = workflowMeta?.parameters.find(p => p.name === 'startFrameCount');
  const endFrameCountParam = workflowMeta?.parameters.find(p => p.name === 'endFrameCount');
  const frameRateParam = workflowMeta?.parameters.find(p => p.name === 'frameRate');
  const frameCountParam = workflowMeta?.parameters.find(p => p.name === 'frameCount');

  // 每次打开弹窗时，从当前已提交状态创建一份完整草稿。
  useEffect(() => {
    if (open) {
      const currentMeta = availableWorkflows.find(w => w.key === currentWorkflow);
      const parameter = (name: string) => currentMeta?.parameters.find(item => item.name === name);
      form.setFieldsValue({
        workflow: currentWorkflow,
        strength,
        count,
        loraPrompt,
        width: width ?? Number(parameter('width')?.default ?? 1024),
        height: height ?? Number(parameter('height')?.default ?? 1024),
        useOriginalSize,
        startFrameCount: startFrameCount ?? Number(parameter('startFrameCount')?.default ?? 0),
        endFrameCount: endFrameCount ?? Number(parameter('endFrameCount')?.default ?? 33),
        frameRate: frameRate ?? Number(parameter('frameRate')?.default ?? 16),
        frameCount: frameCount ?? Number(parameter('frameCount')?.default ?? 33),
        selectOptions: { ...selectOptions },
      });
    }
  }, [open, form, currentWorkflow, availableWorkflows, strength, count, loraPrompt, width, height, useOriginalSize, startFrameCount, endFrameCount, frameRate, frameCount, selectOptions]);

  const handleDraftWorkflowChange = (workflow: string) => {
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
      loraPrompt: String(parameter('lora_prompt')?.default ?? ''),
      width: parameter('width') ? Number(parameter('width')?.default) : null,
      height: parameter('height') ? Number(parameter('height')?.default) : null,
      useOriginalSize: true,
      startFrameCount: parameter('startFrameCount') ? Number(parameter('startFrameCount')?.default) : null,
      endFrameCount: parameter('endFrameCount') ? Number(parameter('endFrameCount')?.default) : null,
      frameRate: parameter('frameRate') ? Number(parameter('frameRate')?.default) : null,
      frameCount: parameter('frameCount') ? Number(parameter('frameCount')?.default) : null,
      selectOptions: nextSelectOptions,
    });
  };

  const handleOk = async () => {
    const values = await form.validateFields();
    commitGenerationSettings({
      ...values,
      loraPrompt: values.loraPrompt || '',
      width: hasWidth ? values.width : null,
      height: hasHeight ? values.height : null,
      startFrameCount: hasStartFrameCount ? values.startFrameCount : null,
      endFrameCount: hasEndFrameCount ? values.endFrameCount : null,
      frameRate: hasFrameRate ? values.frameRate : null,
      frameCount: hasFrameCount ? values.frameCount : null,
      selectOptions: values.selectOptions ?? {},
    });
    onClose();
  };

  const handleCancel = () => {
    onClose();
  };

  return (
    <Modal
      title="生成设置"
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
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
          loraPrompt: loraPrompt,
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
          <Form.Item label="生成方式" name="workflow">
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
          <Form.Item key={param.name} label={param.label} name={['selectOptions', param.name]}>
            <Select
              options={(param.options || []).map(v => ({ label: v, value: v }))}
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
                    min={countParam?.min ?? 1}
                    max={countParam?.max ?? 8}
                    step={countParam?.step ?? 1}
                    marks={{ 1: '1', 2: '2', 4: '4', 6: '6', 8: '8' }}
                  />
                </Form.Item>
              </Col>
              <Col>
                <Form.Item name="count" noStyle>
                  <InputNumber
                    min={countParam?.min ?? 1}
                    max={countParam?.max ?? 8}
                    step={countParam?.step ?? 1}
                    size="small"
                    style={{ width: 70 }}
                  />
                </Form.Item>
              </Col>
            </Row>
          </Form.Item>
        )}

        {hasLoraPrompt && (
          <Form.Item label="LoRA 提示词" name="loraPrompt">
            <Input
              placeholder="例如: <lora:style_name:0.8>"
              allowClear
            />
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
                      min={widthParam?.min || 512}
                      max={widthParam?.max || 2048}
                      step={widthParam?.step || 64}
                    />
                  </Form.Item>
                </Col>
                <Col>
                  <Form.Item name="width" noStyle>
                    <InputNumber
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
                    min={heightParam?.min || 512}
                    max={heightParam?.max || 2048}
                    step={heightParam?.step || 64}
                  />
                </Form.Item>
              </Col>
              <Col>
                <Form.Item name="height" noStyle>
                  <InputNumber
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

        {hasStartFrameCount && (
          <Form.Item label={startFrameCountParam?.label || '起始帧长度'}>
            <Row className="settings-control-row" align="middle">
              <Col flex="auto">
                <Form.Item name="startFrameCount" noStyle>
                  <Slider
                    min={startFrameCountParam?.min ?? 0}
                    max={startFrameCountParam?.max ?? 200}
                    step={startFrameCountParam?.step ?? 1}
                  />
                </Form.Item>
              </Col>
              <Col>
                <Form.Item name="startFrameCount" noStyle>
                  <InputNumber
                    min={startFrameCountParam?.min ?? 0}
                    max={startFrameCountParam?.max ?? 200}
                    step={startFrameCountParam?.step ?? 1}
                    size="small"
                    style={{ width: 70 }}
                  />
                </Form.Item>
              </Col>
            </Row>
          </Form.Item>
        )}

        {hasEndFrameCount && (
          <Form.Item label={endFrameCountParam?.label || '结束帧长度'}>
            <Row className="settings-control-row" align="middle">
              <Col flex="auto">
                <Form.Item name="endFrameCount" noStyle>
                  <Slider
                    min={endFrameCountParam?.min ?? 0}
                    max={endFrameCountParam?.max ?? 200}
                    step={endFrameCountParam?.step ?? 1}
                  />
                </Form.Item>
              </Col>
              <Col>
                <Form.Item name="endFrameCount" noStyle>
                  <InputNumber
                    min={endFrameCountParam?.min ?? 0}
                    max={endFrameCountParam?.max ?? 200}
                    step={endFrameCountParam?.step ?? 1}
                    size="small"
                    style={{ width: 70 }}
                  />
                </Form.Item>
              </Col>
            </Row>
          </Form.Item>
        )}

        {hasFrameRate && (
          <Form.Item label={frameRateParam?.label || '帧率'}>
            <Row className="settings-control-row" align="middle">
              <Col flex="auto">
                <Form.Item name="frameRate" noStyle>
                  <Slider
                    min={frameRateParam?.min ?? 1}
                    max={frameRateParam?.max ?? 60}
                    step={frameRateParam?.step ?? 1}
                    marks={{ 1: '1', 16: '16', 30: '30', 60: '60' }}
                  />
                </Form.Item>
              </Col>
              <Col>
                <Form.Item name="frameRate" noStyle>
                  <InputNumber
                    min={frameRateParam?.min ?? 1}
                    max={frameRateParam?.max ?? 60}
                    step={frameRateParam?.step ?? 1}
                    size="small"
                    style={{ width: 70 }}
                  />
                </Form.Item>
              </Col>
            </Row>
          </Form.Item>
        )}

        {hasFrameCount && (
          <Form.Item label={frameCountParam?.label || '总帧数'}>
            <Row className="settings-control-row" align="middle">
              <Col flex="auto">
                <Form.Item name="frameCount" noStyle>
                  <Slider
                    min={frameCountParam?.min ?? 1}
                    max={frameCountParam?.max ?? 200}
                    step={frameCountParam?.step ?? 1}
                  />
                </Form.Item>
              </Col>
              <Col>
                <Form.Item name="frameCount" noStyle>
                  <InputNumber
                    min={frameCountParam?.min ?? 1}
                    max={frameCountParam?.max ?? 200}
                    step={frameCountParam?.step ?? 1}
                    size="small"
                    style={{ width: 70 }}
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
