import { useEffect } from 'react';
import { Modal, Form, Slider, InputNumber, Input, Row, Col, Switch } from 'antd';
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
    useOriginalSize,
    startFrameCount,
    endFrameCount,
    frameRate,
    setStrength,
    setCount,
    setLoraPrompt,
    setImagesPerRow,
    setWidth,
    setHeight,
    setUseOriginalSize,
    setStartFrameCount,
    setEndFrameCount,
    setFrameRate,
  } = useAppStore();

  const [form] = Form.useForm();

  // 获取当前工作流的参数配置
  const workflowMeta = availableWorkflows.find(w => w.key === currentWorkflow);
  const hasStrength = workflowMeta?.parameters.some(p => p.name === 'strength') || false;
  const hasCount = workflowMeta?.parameters.some(p => p.name === 'count') || false;
  const hasLoraPrompt = workflowMeta?.parameters.some(p => p.name === 'lora_prompt') || false;
  const hasWidth = workflowMeta?.parameters.some(p => p.name === 'width') || false;
  const hasHeight = workflowMeta?.parameters.some(p => p.name === 'height') || false;
  const hasStartFrameCount = workflowMeta?.parameters.some(p => p.name === 'startFrameCount') || false;
  const hasEndFrameCount = workflowMeta?.parameters.some(p => p.name === 'endFrameCount') || false;
  const hasFrameRate = workflowMeta?.parameters.some(p => p.name === 'frameRate') || false;
  const supportsOriginalSize = workflowMeta?.supports_original_size === true;

  // 获取 width 和 height 的参数配置
  const widthParam = workflowMeta?.parameters.find(p => p.name === 'width');
  const heightParam = workflowMeta?.parameters.find(p => p.name === 'height');
  const startFrameCountParam = workflowMeta?.parameters.find(p => p.name === 'startFrameCount');
  const endFrameCountParam = workflowMeta?.parameters.find(p => p.name === 'endFrameCount');
  const frameRateParam = workflowMeta?.parameters.find(p => p.name === 'frameRate');

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
        startFrameCount: startFrameCount ?? startFrameCountParam?.default ?? 0,
        endFrameCount: endFrameCount ?? endFrameCountParam?.default ?? 33,
        frameRate: frameRate ?? frameRateParam?.default ?? 16,
      });
    }
  }, [open, form, strength, count, loraPrompt, imagesPerRow, width, height, widthParam, heightParam, startFrameCount, endFrameCount, frameRate, startFrameCountParam, endFrameCountParam, frameRateParam]);

  const handleOk = () => {
    form.validateFields().then((values) => {
      setStrength(values.strength);
      setCount(values.count);
      setLoraPrompt(values.loraPrompt || '');
      setImagesPerRow(values.imagesPerRow);
      if (hasWidth) setWidth(values.width);
      if (hasHeight) setHeight(values.height);
      if (hasStartFrameCount) setStartFrameCount(values.startFrameCount);
      if (hasEndFrameCount) setEndFrameCount(values.endFrameCount);
      if (hasFrameRate) setFrameRate(values.frameRate);
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
      destroyOnClose
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
            {supportsOriginalSize && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13 }}>使用原图尺寸</span>
                <Switch
                  size="small"
                  checked={useOriginalSize}
                  onChange={setUseOriginalSize}
                />
              </div>
            )}
            {(!useOriginalSize || !supportsOriginalSize) && (
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
            )}
          </Form.Item>
        )}

        {hasHeight && (!useOriginalSize || !supportsOriginalSize) && (
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

        {hasStartFrameCount && (
          <Form.Item label={startFrameCountParam?.label || '起始帧长度'}>
            <Row gutter={12} align="middle">
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
            <Row gutter={12} align="middle">
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
            <Row gutter={12} align="middle">
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
