import { useEffect } from 'react';
import { Slider, InputNumber, Row, Col, Typography, Input, Select, Button } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';

const { Title, Text } = Typography;

export default function ParametersPanel() {
  const { 
    currentWorkflow,
    availableWorkflows,
    strength, 
    count, 
    loraPrompt,
    width,
    height,
    checkpoint,
    modelOptions,
    setStrength, 
    setCount,
    setLoraPrompt,
    setWidth,
    setHeight,
    setCheckpoint,
    loadModelOptions
  } = useAppStore();

  useEffect(() => {
    loadModelOptions();
  }, []);

  // 解析 LoRA 字符串
  const parseLoras = (str: string) => {
    if (!str) return [];
    const regex = /<lora:([^:]+):([0-9.]+)>/g;
    const matches = [...str.matchAll(regex)];
    return matches.map(m => ({ name: m[1], strength: parseFloat(m[2]) }));
  };

  const loras = parseLoras(loraPrompt || '');

  const handleUpdateLora = (index: number, field: 'name' | 'strength', value: any) => {
    const newLoras = [...loras];
    if (field === 'name') newLoras[index].name = value;
    if (field === 'strength') newLoras[index].strength = value;
    
    const str = newLoras.map(l => `<lora:${l.name}:${l.strength}>`).join('');
    setLoraPrompt(str);
  };

  const handleAddLora = () => {
    const defaultName = modelOptions.loras[0];
    if (!defaultName) return;
    const str = (loraPrompt || '') + `<lora:${defaultName}:0.8>`;
    setLoraPrompt(str);
  };

  const handleRemoveLora = (index: number) => {
    const newLoras = loras.filter((_, i) => i !== index);
    const str = newLoras.map(l => `<lora:${l.name}:${l.strength}>`).join('');
    setLoraPrompt(str);
  };

  // 获取当前工作流的参数配置
  const workflowMeta = availableWorkflows.find(w => w.key === currentWorkflow);
  if (!workflowMeta) {
    return null;
  }

  // 检查参数是否存在
  const hasStrength = workflowMeta.parameters.some(p => p.name === 'strength');
  const hasCount = workflowMeta.parameters.some(p => p.name === 'count');
  const hasLoraPrompt = workflowMeta.parameters.some(p => p.name === 'lora_prompt');
  const hasWidth = workflowMeta.parameters.some(p => p.name === 'width');
  const hasHeight = workflowMeta.parameters.some(p => p.name === 'height');

  return (
    <div>
      <Title level={5} style={{ marginBottom: 16 }}>参数设置</Title>
      
      {/* 底模选择 */}
      <div style={{ marginBottom: 24 }}>
        <Text strong style={{ fontSize: 13 }}>底模 (Checkpoint)</Text>
        <Select
          style={{ width: '100%', marginTop: 8 }}
          placeholder="使用默认底模"
          allowClear
          value={checkpoint}
          onChange={setCheckpoint}
          options={modelOptions.checkpoints.map(c => ({ label: c, value: c }))}
          showSearch
        />
      </div>

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
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text strong style={{ fontSize: 13 }}>
              {workflowMeta.parameters.find(p => p.name === 'lora_prompt')?.label || 'LoRA 模型'}
            </Text>
            <Button 
              type="link" 
              size="small" 
              icon={<PlusOutlined />} 
              onClick={handleAddLora}
              disabled={modelOptions.loras.length === 0}
            >
              添加
            </Button>
          </div>
          
          {/* LoRA 列表 */}
          <div style={{ marginTop: 8, marginBottom: 12 }}>
            {loras.map((lora, index) => (
              <div key={index} style={{ marginBottom: 8, padding: 8, background: '#f5f5f5', borderRadius: 4 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                  <Select
                    style={{ flex: 1 }}
                    size="small"
                    value={lora.name}
                    onChange={(val) => handleUpdateLora(index, 'name', val)}
                    options={modelOptions.loras.map(l => ({ label: l, value: l }))}
                    showSearch
                  />
                  <Button 
                    type="text" 
                    size="small" 
                    icon={<DeleteOutlined />} 
                    danger 
                    onClick={() => handleRemoveLora(index)}
                  />
                </div>
                <Row gutter={8} align="middle">
                  <Col span={6}>
                    <Text type="secondary" style={{ fontSize: 12 }}>强度: {lora.strength}</Text>
                  </Col>
                  <Col span={18}>
                    <Slider
                      min={0}
                      max={2}
                      step={0.05}
                      value={lora.strength}
                      onChange={(val) => handleUpdateLora(index, 'strength', val)}
                      tooltip={{ formatter: (value) => value }}
                    />
                  </Col>
                </Row>
              </div>
            ))}
            {loras.length === 0 && (
              <div style={{ textAlign: 'center', color: '#999', fontSize: 12, padding: '8px 0' }}>
                暂无 LoRA，点击右上角添加
              </div>
            )}
          </div>

          <Text type="secondary" style={{ fontSize: 12 }}>高级设置 (LoRA Prompt)</Text>
          <Input.TextArea
            value={loraPrompt}
            onChange={(e) => setLoraPrompt(e.target.value)}
            placeholder="<lora:模型名:权重>"
            style={{ marginTop: 4, fontSize: 12 }}
            autoSize={{ minRows: 1, maxRows: 3 }}
          />
        </div>
      )}

      {hasWidth && (
        <div style={{ marginBottom: 24 }}>
          <Text strong style={{ fontSize: 13 }}>
            {workflowMeta.parameters.find(p => p.name === 'width')?.label || '图像宽度'}
          </Text>
          <Row gutter={12} align="middle" style={{ marginTop: 12 }}>
            <Col flex="auto">
              <Slider
                min={workflowMeta.parameters.find(p => p.name === 'width')?.min || 512}
                max={workflowMeta.parameters.find(p => p.name === 'width')?.max || 2048}
                step={workflowMeta.parameters.find(p => p.name === 'width')?.step || 64}
                value={width ?? (workflowMeta.parameters.find(p => p.name === 'width')?.default as number) ?? 1024}
                onChange={setWidth}
              />
            </Col>
            <Col>
              <InputNumber
                min={workflowMeta.parameters.find(p => p.name === 'width')?.min || 512}
                max={workflowMeta.parameters.find(p => p.name === 'width')?.max || 2048}
                step={workflowMeta.parameters.find(p => p.name === 'width')?.step || 64}
                value={width ?? (workflowMeta.parameters.find(p => p.name === 'width')?.default as number) ?? 1024}
                onChange={(val) => setWidth(val || 1024)}
                size="small"
                style={{ width: 80 }}
              />
            </Col>
          </Row>
        </div>
      )}

      {hasHeight && (
        <div>
          <Text strong style={{ fontSize: 13 }}>
            {workflowMeta.parameters.find(p => p.name === 'height')?.label || '图像高度'}
          </Text>
          <Row gutter={12} align="middle" style={{ marginTop: 12 }}>
            <Col flex="auto">
              <Slider
                min={workflowMeta.parameters.find(p => p.name === 'height')?.min || 512}
                max={workflowMeta.parameters.find(p => p.name === 'height')?.max || 2048}
                step={workflowMeta.parameters.find(p => p.name === 'height')?.step || 64}
                value={height ?? (workflowMeta.parameters.find(p => p.name === 'height')?.default as number) ?? 1024}
                onChange={setHeight}
              />
            </Col>
            <Col>
              <InputNumber
                min={workflowMeta.parameters.find(p => p.name === 'height')?.min || 512}
                max={workflowMeta.parameters.find(p => p.name === 'height')?.max || 2048}
                step={workflowMeta.parameters.find(p => p.name === 'height')?.step || 64}
                value={height ?? (workflowMeta.parameters.find(p => p.name === 'height')?.default as number) ?? 1024}
                onChange={(val) => setHeight(val || 1024)}
                size="small"
                style={{ width: 80 }}
              />
            </Col>
          </Row>
        </div>
      )}
    </div>
  );
}
