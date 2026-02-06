import { useEffect } from 'react';
import { Modal, Form, Slider, InputNumber, Input, Row, Col } from 'antd';
import { useAppStore } from '../stores/appStore';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const {
    currentWorkflow,
    availableWorkflows,
    strength,
    count,
    loraPrompt,
    imagesPerRow,
    width,
    height,
    setStrength,
    setCount,
    setLoraPrompt,
    setImagesPerRow,
    setWidth,
    setHeight,
  } = useAppStore();

  const [form] = Form.useForm();

  // 获取当前工作流的参数配置
  const workflowMeta = availableWorkflows.find(w => w.key === currentWorkflow);
  const hasStrength = workflowMeta?.parameters.some(p => p.name === 'strength') || false;
  const hasCount = workflowMeta?.parameters.some(p => p.name === 'count') || false;
  const hasLoraPrompt = workflowMeta?.parameters.some(p => p.name === 'lora_prompt') || false;
  const hasWidth = workflowMeta?.parameters.some(p => p.name === 'width') || false;
  const hasHeight = workflowMeta?.parameters.some(p => p.name === 'height') || false;

  // 获取 width 和 height 的参数配置
  const widthParam = workflowMeta?.parameters.find(p => p.name === 'width');
  const heightParam = workflowMeta?.parameters.find(p => p.name === 'height');

  // 当弹窗打开时，重置表单值为当前状态
  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        strength: strength,
        count: count,
        loraPrompt: loraPrompt,
        imagesPerRow: imagesPerRow,
        width: width ?? widthParam?.default ?? 1024,
        height: height ?? heightParam?.default ?? 1024,
      });
    }
  }, [open, form, strength, count, loraPrompt, imagesPerRow, width, height, widthParam, heightParam]);

  const handleOk = () => {
    form.validateFields().then((values) => {
      setStrength(values.strength);
      setCount(values.count);
      setLoraPrompt(values.loraPrompt || '');
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
          imagesPerRow: imagesPerRow,
        }}
      >
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
          <Form.Item label="LoRA 提示词" name="loraPrompt">
            <Input
              placeholder="例如: <lora:style_name:0.8>"
              allowClear
            />
          </Form.Item>
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
      </Form>
    </Modal>
  );
}
