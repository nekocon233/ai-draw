import { useEffect, useMemo, useState } from 'react';
import { Modal, Form, Slider, InputNumber, Input, Row, Col, Button, Divider, Select, Typography } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import WorkflowAdminModal from './WorkflowAdminModal';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type LoraItem = { name: string; strength: number };

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const {
    currentWorkflow,
    availableWorkflows,
    strength,
    count,
    loraPrompt,
    checkpoint,
    modelOptions,
    imagesPerRow,
    width,
    height,
    setStrength,
    setCount,
    setLoraPrompt,
    setCheckpoint,
    loadModelOptions,
    setImagesPerRow,
    setWidth,
    setHeight,
  } = useAppStore();

  const [form] = Form.useForm();
  const [workflowAdminOpen, setWorkflowAdminOpen] = useState(false);
  const [loraItems, setLoraItems] = useState<LoraItem[]>([]);

  const parseLoras = (text: string): LoraItem[] => {
    if (!text) return [];
    const regex = /<lora:([^:]+):([0-9.]+)>/g;
    const matches = [...text.matchAll(regex)];
    return matches
      .map((m) => ({ name: m[1], strength: Number.parseFloat(m[2]) }))
      .filter((x) => x.name && Number.isFinite(x.strength));
  };

  const buildLoraPrompt = (items: LoraItem[]) => {
    return items.map((x) => `<lora:${x.name}:${x.strength}>`).join('');
  };

  const loraOptions = useMemo(
    () => modelOptions.loras.map((l) => ({ label: l, value: l })),
    [modelOptions.loras]
  );

  const workflowMeta = availableWorkflows.find(w => w.key === currentWorkflow);
  const hasStrength = workflowMeta?.parameters.some(p => p.name === 'strength') || false;
  const hasCount = workflowMeta?.parameters.some(p => p.name === 'count') || false;
  const hasLoraPrompt = workflowMeta?.parameters.some(p => p.name === 'lora_prompt') || false;
  const hasWidth = workflowMeta?.parameters.some(p => p.name === 'width') || false;
  const hasHeight = workflowMeta?.parameters.some(p => p.name === 'height') || false;

  const usesUnetModel = useMemo(() => {
    if (workflowMeta?.model_loader) {
      return workflowMeta.model_loader === 'unet' || workflowMeta.model_loader === 'both';
    }
    return currentWorkflow === 't2i' || currentWorkflow === 'reference_zimage' || currentWorkflow === 'qwen_image_edit' || currentWorkflow === 'sdxl_simple';
  }, [currentWorkflow, workflowMeta?.model_loader]);

  const baseModelLabel = usesUnetModel ? '底模 (UNet)' : '底模 (Checkpoint)';

  const baseModelOptions = useMemo(() => {
    const list = usesUnetModel ? modelOptions.unets : modelOptions.checkpoints;
    return list.map((x) => ({ label: x, value: x }));
  }, [usesUnetModel, modelOptions.unets, modelOptions.checkpoints]);

  // 获取 width 和 height 的参数配置
  const widthParam = workflowMeta?.parameters.find(p => p.name === 'width');
  const heightParam = workflowMeta?.parameters.find(p => p.name === 'height');

  // 当弹窗打开时，重置表单值为当前状态
  useEffect(() => {
    if (open) {
      loadModelOptions();
      form.setFieldsValue({
        strength: strength,
        count: count,
        loraPrompt: loraPrompt,
        checkpoint: checkpoint,
        imagesPerRow: imagesPerRow,
        width: width ?? widthParam?.default ?? 1024,
        height: height ?? heightParam?.default ?? 1024,
      });
      setLoraItems(parseLoras(loraPrompt || ''));
      if (import.meta.env.DEV) {
        console.debug('[SettingsModal] open', {
          workflow: currentWorkflow,
          checkpoint,
          checkpoints: modelOptions.checkpoints.length,
          unets: modelOptions.unets.length,
          loras: modelOptions.loras.length,
        });
      }
    }
  }, [open, form, strength, count, loraPrompt, checkpoint, imagesPerRow, width, height, widthParam, heightParam, loadModelOptions]);

  const handleOk = () => {
    form.validateFields().then((values) => {
      setStrength(values.strength);
      setCount(values.count);
      setLoraPrompt(values.loraPrompt || '');
      setCheckpoint(values.checkpoint ?? null);
      setImagesPerRow(values.imagesPerRow);
      if (hasWidth) setWidth(values.width);
      if (hasHeight) setHeight(values.height);
      onClose();
    });
  };

  const handleCancel = () => {
    onClose();
  };

  return (
    <>
    <Modal
      title="生成设置"
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      width={500}
      centered
      okText="确定"
      cancelText="取消"
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          strength: strength,
          count: count,
          loraPrompt: loraPrompt,
          checkpoint: checkpoint,
          imagesPerRow: imagesPerRow,
        }}
      >
        <Form.Item label={baseModelLabel} name="checkpoint">
          <Select
            allowClear
            placeholder="使用默认底模"
            options={baseModelOptions}
            showSearch
          />
        </Form.Item>

        {hasStrength && (
          <Form.Item label="生成强度">
            <Row gutter={12} align="middle">
              <Col flex="auto">
                <Form.Item name="strength" noStyle>
                  <Slider
                    min={0}
                    max={1}
                    step={0.01}
                    marks={{ 0: '0', 0.5: '0.5', 1: '1' }}
                  />
                </Form.Item>
              </Col>
              <Col>
                <Form.Item name="strength" noStyle>
                  <InputNumber
                    min={0}
                    max={1}
                    step={0.01}
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
            <Row gutter={12} align="middle">
              <Col flex="auto">
                <Form.Item name="count" noStyle>
                  <Slider
                    min={1}
                    max={8}
                    step={1}
                    marks={{ 1: '1', 2: '2', 4: '4', 6: '6', 8: '8' }}
                  />
                </Form.Item>
              </Col>
              <Col>
                <Form.Item name="count" noStyle>
                  <InputNumber
                    min={1}
                    max={8}
                    size="small"
                    style={{ width: 70 }}
                  />
                </Form.Item>
              </Col>
            </Row>
          </Form.Item>
        )}

        {hasLoraPrompt && (
          <>
            <Form.Item
              label={
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>LoRA 选择</span>
                  <Button
                    type="link"
                    size="small"
                    icon={<PlusOutlined />}
                    disabled={modelOptions.loras.length === 0}
                    onClick={() => {
                      const defaultName = modelOptions.loras[0];
                      if (!defaultName) return;
                      const next = [...loraItems, { name: defaultName, strength: 0.8 }];
                      setLoraItems(next);
                      form.setFieldsValue({ loraPrompt: buildLoraPrompt(next) });
                      if (import.meta.env.DEV) {
                        console.debug('[SettingsModal] add lora', next);
                      }
                    }}
                  >
                    添加
                  </Button>
                </div>
              }
            >
              <div>
                {loraItems.length === 0 && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    暂无 LoRA，点击右上角添加；或直接在下方高级输入框手填 loraPrompt
                  </Typography.Text>
                )}
                {loraItems.map((item, idx) => (
                  <div
                    key={`${item.name}-${idx}`}
                    style={{ marginTop: 10, padding: 10, background: '#f5f5f5', borderRadius: 8 }}
                  >
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Select
                        value={item.name}
                        onChange={(val) => {
                          const next = loraItems.map((x, i) => (i === idx ? { ...x, name: val } : x));
                          setLoraItems(next);
                          form.setFieldsValue({ loraPrompt: buildLoraPrompt(next) });
                        }}
                        options={loraOptions}
                        showSearch
                        style={{ flex: 1 }}
                        size="small"
                      />
                      <Button
                        type="text"
                        size="small"
                        icon={<DeleteOutlined />}
                        danger
                        onClick={() => {
                          const next = loraItems.filter((_, i) => i !== idx);
                          setLoraItems(next);
                          form.setFieldsValue({ loraPrompt: buildLoraPrompt(next) });
                          if (import.meta.env.DEV) {
                            console.debug('[SettingsModal] remove lora', next);
                          }
                        }}
                      />
                    </div>
                    <Row gutter={12} align="middle" style={{ marginTop: 8 }}>
                      <Col flex="auto">
                        <Slider
                          min={0}
                          max={1}
                          step={0.05}
                          value={item.strength}
                          onChange={(val) => {
                            const next = loraItems.map((x, i) => (i === idx ? { ...x, strength: val } : x));
                            setLoraItems(next);
                            form.setFieldsValue({ loraPrompt: buildLoraPrompt(next) });
                          }}
                        />
                      </Col>
                      <Col>
                        <InputNumber
                          min={0}
                          max={1}
                          step={0.05}
                          size="small"
                          style={{ width: 80 }}
                          value={item.strength}
                          onChange={(val) => {
                            const strengthValue = typeof val === 'number' ? val : 0;
                            const next = loraItems.map((x, i) => (i === idx ? { ...x, strength: strengthValue } : x));
                            setLoraItems(next);
                            form.setFieldsValue({ loraPrompt: buildLoraPrompt(next) });
                          }}
                        />
                      </Col>
                    </Row>
                  </div>
                ))}
              </div>
            </Form.Item>

            <Form.Item label="高级设置 (LoRA Prompt)" name="loraPrompt">
              <Input.TextArea
                placeholder="例如: <lora:style_name:0.8>"
                allowClear
                autoSize={{ minRows: 2, maxRows: 5 }}
                onChange={(e) => {
                  const text = e.target.value;
                  setLoraItems(parseLoras(text));
                }}
              />
            </Form.Item>
          </>
        )}

        {hasWidth && (
          <Form.Item label={widthParam?.label || "图像宽度"}>
            <Row gutter={12} align="middle">
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
          </Form.Item>
        )}

        {hasHeight && (
          <Form.Item label={heightParam?.label || "图像高度"}>
            <Row gutter={12} align="middle">
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

        <Form.Item label="每行显示数量">
          <Row gutter={12} align="middle">
            <Col flex="auto">
              <Form.Item name="imagesPerRow" noStyle>
                <Slider
                  min={1}
                  max={8}
                  step={1}
                  marks={{ 1: '1', 2: '2', 4: '4', 6: '6', 8: '8' }}
                />
              </Form.Item>
            </Col>
            <Col>
              <Form.Item name="imagesPerRow" noStyle>
                <InputNumber
                  min={1}
                  max={8}
                  size="small"
                  style={{ width: 70 }}
                />
              </Form.Item>
            </Col>
          </Row>
        </Form.Item>

        <Divider style={{ margin: '12px 0' }} />
        <Button onClick={() => setWorkflowAdminOpen(true)} block>
          工作流管理
        </Button>
      </Form>
    </Modal>
    <WorkflowAdminModal open={workflowAdminOpen} onClose={() => setWorkflowAdminOpen(false)} />
    </>
  );
}
