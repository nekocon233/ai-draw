import { useState, useEffect } from 'react';
import { Card, Slider, InputNumber, Row, Col, Typography, Input, Select } from 'antd';
import { useAppStore } from '../stores/appStore';
import { apiService } from '../api/services';

const { Text } = Typography;

export default function ParametersPanel() {
  const { 
    currentWorkflow,
    availableWorkflows,
    strength, 
    count, 
    loraPrompt,
    width,
    height,
    setStrength, 
    setCount,
    setLoraPrompt,
    setWidth,
    setHeight
  } = useAppStore();

  const [loraList, setLoraList] = useState<string[]>([]);
  const [loadingLoras, setLoadingLoras] = useState(false);

  useEffect(() => {
    // 获取 LoRA 列表
    const fetchLoras = async () => {
      try {
        setLoadingLoras(true);
        const res = await apiService.getLoras();
        setLoraList(res.loras || []);
      } catch (error) {
        console.error("Failed to fetch loras:", error);
      } finally {
        setLoadingLoras(false);
      }
    };
    fetchLoras();
  }, []);

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

  const handleLoraChange = (value: string) => {
    // 如果选择了某个 LoRA，自动格式化为标准格式
    // 默认权重设为 0.8，用户可以后续手动修改
    if (value && !value.startsWith('<lora:')) {
      // 提取文件名（不含路径和扩展名）作为显示名称的一部分
      // 但 ComfyUI 通常需要相对路径，所以这里保留原始选择的值
      setLoraPrompt(`<lora:${value}:0.8>`);
    } else {
      setLoraPrompt(value);
    }
  };

  return (
    <Card 
      title="生成参数" 
      size="small" 
      bordered={false}
      style={{ boxShadow: 'none' }}
      headStyle={{ fontSize: 14, fontWeight: 'bold' }}
      bodyStyle={{ padding: '12px 16px' }}
    >
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
          <Text strong style={{ fontSize: 13 }}>
            {workflowMeta.parameters.find(p => p.name === 'lora_prompt')?.label || 'LoRA 提示词'}
          </Text>
          <div style={{ marginTop: 12 }}>
            <Select
              showSearch
              allowClear
              style={{ width: '100%', marginBottom: 8 }}
              placeholder="选择 LoRA 模型"
              optionFilterProp="children"
              loading={loadingLoras}
              onChange={handleLoraChange}
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              options={loraList.map(lora => ({
                value: lora,
                label: lora
              }))}
            />
            <Input
              value={loraPrompt}
              onChange={(e) => setLoraPrompt(e.target.value)}
              placeholder="自定义 LoRA 格式: <lora:模型名:权重>"
            />
          </div>
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
