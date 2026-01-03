import { Slider, InputNumber, Row, Col, Typography, Input } from 'antd';
import { useAppStore } from '../stores/appStore';

const { Title, Text } = Typography;

export default function ParametersPanel() {
  const { 
    currentWorkflow,
    availableWorkflows,
    strength, 
    count, 
    loraPrompt,
    setStrength, 
    setCount,
    setLoraPrompt
  } = useAppStore();

  // 获取当前工作流的参数配置
  const workflowMeta = availableWorkflows.find(w => w.key === currentWorkflow);
  if (!workflowMeta) {
    return null;
  }

  // 检查参数是否存在
  const hasStrength = workflowMeta.parameters.some(p => p.name === 'strength');
  const hasCount = workflowMeta.parameters.some(p => p.name === 'count');
  const hasLoraPrompt = workflowMeta.parameters.some(p => p.name === 'lora_prompt');

  return (
    <div>
      <Title level={5} style={{ marginBottom: 16 }}>参数设置</Title>
      
      {hasStrength && (
        <div style={{ marginBottom: 24 }}>
          <Text strong style={{ fontSize: 13 }}>
            {workflowMeta.parameters.find(p => p.name === 'strength')?.label || '重绘强度'}
          </Text>
          <Row gutter={12} align="middle" style={{ marginTop: 12 }}>
            <Col flex="auto">
              <Slider
                min={workflowMeta.parameters.find(p => p.name === 'strength')?.min || 0}
                max={workflowMeta.parameters.find(p => p.name === 'strength')?.max || 1}
                step={workflowMeta.parameters.find(p => p.name === 'strength')?.step || 0.01}
                value={strength}
                onChange={setStrength}
              />
            </Col>
            <Col>
              <InputNumber
                min={workflowMeta.parameters.find(p => p.name === 'strength')?.min || 0}
                max={workflowMeta.parameters.find(p => p.name === 'strength')?.max || 1}
                step={workflowMeta.parameters.find(p => p.name === 'strength')?.step || 0.01}
                value={strength}
                onChange={(val) => setStrength(val || 0.5)}
                size="small"
                style={{ width: 65 }}
              />
            </Col>
          </Row>
        </div>
      )}

      {hasCount && (
        <div style={{ marginBottom: 24 }}>
          <Text strong style={{ fontSize: 13 }}>
            {workflowMeta.parameters.find(p => p.name === 'count')?.label || '生成数量'}
          </Text>
          <Row gutter={12} align="middle" style={{ marginTop: 12 }}>
            <Col flex="auto">
              <Slider
                min={workflowMeta.parameters.find(p => p.name === 'count')?.min || 1}
                max={workflowMeta.parameters.find(p => p.name === 'count')?.max || 8}
                step={workflowMeta.parameters.find(p => p.name === 'count')?.step || 1}
                value={count}
                onChange={setCount}
                marks={{ 1: '1', 4: '4', 8: '8' }}
              />
            </Col>
            <Col>
              <InputNumber
                min={workflowMeta.parameters.find(p => p.name === 'count')?.min || 1}
                max={workflowMeta.parameters.find(p => p.name === 'count')?.max || 8}
                step={workflowMeta.parameters.find(p => p.name === 'count')?.step || 1}
                value={count}
                onChange={(val) => setCount(val || 1)}
                size="small"
                style={{ width: 65 }}
              />
            </Col>
          </Row>
        </div>
      )}

      {hasLoraPrompt && (
        <div>
          <Text strong style={{ fontSize: 13 }}>
            {workflowMeta.parameters.find(p => p.name === 'lora_prompt')?.label || 'LoRA 提示词'}
          </Text>
          <Input
            value={loraPrompt}
            onChange={(e) => setLoraPrompt(e.target.value)}
            placeholder="<lora:模型名:权重>"
            style={{ marginTop: 12 }}
          />
        </div>
      )}
    </div>
  );
}
