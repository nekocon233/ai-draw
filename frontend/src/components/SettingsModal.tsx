import { useEffect } from 'react';
import { Modal, Form, Slider, InputNumber, Input, Row, Col, Radio } from 'antd';
import { useAppStore } from '../stores/appStore';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const {
    strength,
    count,
    loraPrompt,
    currentWorkflow,
    imagesPerRow,
    setStrength,
    setCount,
    setLoraPrompt,
    setCurrentWorkflow,
    setImagesPerRow,
  } = useAppStore();

  const [form] = Form.useForm();

  // 当弹窗打开时，重置表单值为当前状态
  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        workflow: currentWorkflow,
        strength: strength,
        count: count,
        loraPrompt: loraPrompt,
        imagesPerRow: imagesPerRow,
      });
    }
  }, [open, form, currentWorkflow, strength, count, loraPrompt, imagesPerRow]);

  const handleOk = () => {
    form.validateFields().then((values) => {
      setStrength(values.strength);
      setCount(values.count);
      setLoraPrompt(values.loraPrompt || '');
      setCurrentWorkflow(values.workflow);
      setImagesPerRow(values.imagesPerRow);
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
          workflow: currentWorkflow,
          strength: strength,
          count: count,
          loraPrompt: loraPrompt,
          imagesPerRow: imagesPerRow,
        }}
      >
        <Form.Item label="工作流类型" name="workflow">
          <Radio.Group buttonStyle="solid" style={{ width: '100%', display: 'flex' }}>
            <Radio.Button value="参考" style={{ flex: 1, textAlign: 'center' }}>参考</Radio.Button>
            <Radio.Button value="上色" style={{ flex: 1, textAlign: 'center' }}>上色</Radio.Button>
            <Radio.Button value="图生图" style={{ flex: 1, textAlign: 'center' }}>图生图</Radio.Button>
            <Radio.Button value="线稿" style={{ flex: 1, textAlign: 'center' }}>线稿</Radio.Button>
          </Radio.Group>
        </Form.Item>

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

        <Form.Item label="LoRA 提示词" name="loraPrompt">
          <Input
            placeholder="例如: <lora:style_name:0.8>"
            allowClear
          />
        </Form.Item>

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
