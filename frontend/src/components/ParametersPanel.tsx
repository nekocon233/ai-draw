import { Slider, InputNumber, Row, Col, Typography, Input, Switch, Select } from 'antd';
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
    useOriginalSize,
    startFrameCount,
    endFrameCount,
    frameRate,
    frameCount,
    setStrength, 
    setCount,
    setLoraPrompt,
    setWidth,
    setHeight,
    setUseOriginalSize,
    setStartFrameCount,
    setEndFrameCount,
    setFrameRate,
    setFrameCount,
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
  const hasWidth = workflowMeta.parameters.some(p => p.name === 'width');
  const hasHeight = workflowMeta.parameters.some(p => p.name === 'height');
  const hasStartFrameCount = workflowMeta.parameters.some(p => p.name === 'startFrameCount');
  const hasEndFrameCount = workflowMeta.parameters.some(p => p.name === 'endFrameCount');
  const hasFrameRate = workflowMeta.parameters.some(p => p.name === 'frameRate');
  const hasFrameCount = workflowMeta.parameters.some(p => p.name === 'frameCount');
  const hasPixelLabAction = workflowMeta.parameters.some(p => p.name === 'action');
  const hasPixelLabView = workflowMeta.parameters.some(p => p.name === 'view');
  const hasPixelLabDirection = workflowMeta.parameters.some(p => p.name === 'direction');
  const supportsOriginalSize = workflowMeta.supports_original_size === true;

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
        <div style={{ marginBottom: 24 }}>
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

      {hasWidth && (
        <div style={{ marginBottom: useOriginalSize && supportsOriginalSize ? 8 : 24 }}>
          {supportsOriginalSize && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text strong style={{ fontSize: 13 }}>使用原图尺寸</Text>
              <Switch
                size="small"
                checked={useOriginalSize}
                onChange={setUseOriginalSize}
              />
            </div>
          )}
          {(!useOriginalSize || !supportsOriginalSize) && (
            <>
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
            </>
          )}
        </div>
      )}

      {hasHeight && (!useOriginalSize || !supportsOriginalSize) && (
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

      {hasStartFrameCount && (
        <div style={{ marginBottom: 24 }}>
          <Text strong style={{ fontSize: 13 }}>
            {workflowMeta.parameters.find(p => p.name === 'startFrameCount')?.label || '起始帧长度'}
          </Text>
          <Row gutter={12} align="middle" style={{ marginTop: 12 }}>
            <Col flex="auto">
              <Slider
                min={workflowMeta.parameters.find(p => p.name === 'startFrameCount')?.min ?? 0}
                max={workflowMeta.parameters.find(p => p.name === 'startFrameCount')?.max ?? 200}
                step={workflowMeta.parameters.find(p => p.name === 'startFrameCount')?.step ?? 1}
                value={startFrameCount ?? (workflowMeta.parameters.find(p => p.name === 'startFrameCount')?.default as number) ?? 0}
                onChange={setStartFrameCount}
              />
            </Col>
            <Col>
              <InputNumber
                min={workflowMeta.parameters.find(p => p.name === 'startFrameCount')?.min ?? 0}
                max={workflowMeta.parameters.find(p => p.name === 'startFrameCount')?.max ?? 200}
                step={workflowMeta.parameters.find(p => p.name === 'startFrameCount')?.step ?? 1}
                value={startFrameCount ?? (workflowMeta.parameters.find(p => p.name === 'startFrameCount')?.default as number) ?? 0}
                onChange={(val) => setStartFrameCount(val ?? 0)}
                size="small"
                style={{ width: 65 }}
              />
            </Col>
          </Row>
        </div>
      )}

      {hasEndFrameCount && (
        <div style={{ marginBottom: 24 }}>
          <Text strong style={{ fontSize: 13 }}>
            {workflowMeta.parameters.find(p => p.name === 'endFrameCount')?.label || '结束帧长度'}
          </Text>
          <Row gutter={12} align="middle" style={{ marginTop: 12 }}>
            <Col flex="auto">
              <Slider
                min={workflowMeta.parameters.find(p => p.name === 'endFrameCount')?.min ?? 0}
                max={workflowMeta.parameters.find(p => p.name === 'endFrameCount')?.max ?? 200}
                step={workflowMeta.parameters.find(p => p.name === 'endFrameCount')?.step ?? 1}
                value={endFrameCount ?? (workflowMeta.parameters.find(p => p.name === 'endFrameCount')?.default as number) ?? 33}
                onChange={setEndFrameCount}
              />
            </Col>
            <Col>
              <InputNumber
                min={workflowMeta.parameters.find(p => p.name === 'endFrameCount')?.min ?? 0}
                max={workflowMeta.parameters.find(p => p.name === 'endFrameCount')?.max ?? 200}
                step={workflowMeta.parameters.find(p => p.name === 'endFrameCount')?.step ?? 1}
                value={endFrameCount ?? (workflowMeta.parameters.find(p => p.name === 'endFrameCount')?.default as number) ?? 33}
                onChange={(val) => setEndFrameCount(val ?? 33)}
                size="small"
                style={{ width: 65 }}
              />
            </Col>
          </Row>
        </div>
      )}

      {hasFrameRate && (
        <div style={{ marginBottom: 24 }}>
          <Text strong style={{ fontSize: 13 }}>
            {workflowMeta.parameters.find(p => p.name === 'frameRate')?.label || '帧率'}
          </Text>
          <Row gutter={12} align="middle" style={{ marginTop: 12 }}>
            <Col flex="auto">
              <Slider
                min={workflowMeta.parameters.find(p => p.name === 'frameRate')?.min ?? 1}
                max={workflowMeta.parameters.find(p => p.name === 'frameRate')?.max ?? 60}
                step={workflowMeta.parameters.find(p => p.name === 'frameRate')?.step ?? 1}
                value={frameRate ?? (workflowMeta.parameters.find(p => p.name === 'frameRate')?.default as number) ?? 16}
                onChange={setFrameRate}
              />
            </Col>
            <Col>
              <InputNumber
                min={workflowMeta.parameters.find(p => p.name === 'frameRate')?.min ?? 1}
                max={workflowMeta.parameters.find(p => p.name === 'frameRate')?.max ?? 60}
                step={workflowMeta.parameters.find(p => p.name === 'frameRate')?.step ?? 1}
                value={frameRate ?? (workflowMeta.parameters.find(p => p.name === 'frameRate')?.default as number) ?? 16}
                onChange={(val) => setFrameRate(val ?? 16)}
                size="small"
                style={{ width: 65 }}
              />
            </Col>
          </Row>
        </div>
      )}

      {hasFrameCount && (
        <div style={{ marginBottom: 24 }}>
          <Text strong style={{ fontSize: 13 }}>
            {workflowMeta.parameters.find(p => p.name === 'frameCount')?.label || '总帧数'}
          </Text>
          <Row gutter={12} align="middle" style={{ marginTop: 12 }}>
            <Col flex="auto">
              <Slider
                min={workflowMeta.parameters.find(p => p.name === 'frameCount')?.min ?? 1}
                max={workflowMeta.parameters.find(p => p.name === 'frameCount')?.max ?? 200}
                step={workflowMeta.parameters.find(p => p.name === 'frameCount')?.step ?? 1}
                value={frameCount ?? (workflowMeta.parameters.find(p => p.name === 'frameCount')?.default as number) ?? 33}
                onChange={setFrameCount}
              />
            </Col>
            <Col>
              <InputNumber
                min={workflowMeta.parameters.find(p => p.name === 'frameCount')?.min ?? 1}
                max={workflowMeta.parameters.find(p => p.name === 'frameCount')?.max ?? 200}
                step={workflowMeta.parameters.find(p => p.name === 'frameCount')?.step ?? 1}
                value={frameCount ?? (workflowMeta.parameters.find(p => p.name === 'frameCount')?.default as number) ?? 33}
                onChange={(val) => setFrameCount(val ?? 33)}
                size="small"
                style={{ width: 65 }}
              />
            </Col>
          </Row>
        </div>
      )}

      {/* PixelLab 动画参数 */}
      {hasPixelLabAction && (
        <div style={{ marginBottom: 24 }}>
          <Text strong style={{ fontSize: 13 }}>
            {workflowMeta.parameters.find(p => p.name === 'action')?.label || '动作'}
          </Text>
          <Select
            value={workflowMeta.parameters.find(p => p.name === 'action')?.default as string || 'walk'}
            onChange={(val) => useAppStore.getState().setPixelLabAction(val)}
            style={{ width: '100%', marginTop: 12 }}
            options={['walk', 'run', 'jump', 'attack', 'idle'].map(v => ({ label: v, value: v }))}
          />
        </div>
      )}

      {hasPixelLabView && (
        <div style={{ marginBottom: 24 }}>
          <Text strong style={{ fontSize: 13 }}>
            {workflowMeta.parameters.find(p => p.name === 'view')?.label || '视角'}
          </Text>
          <Select
            value={workflowMeta.parameters.find(p => p.name === 'view')?.default as string || 'sidescroller'}
            onChange={(val) => useAppStore.getState().setPixelLabView(val)}
            style={{ width: '100%', marginTop: 12 }}
            options={['sidescroller', 'low top-down', 'high top-down'].map(v => ({ label: v, value: v }))}
          />
        </div>
      )}

      {hasPixelLabDirection && (
        <div style={{ marginBottom: 24 }}>
          <Text strong style={{ fontSize: 13 }}>
            {workflowMeta.parameters.find(p => p.name === 'direction')?.label || '朝向'}
          </Text>
          <Select
            value={workflowMeta.parameters.find(p => p.name === 'direction')?.default as string || 'east'}
            onChange={(val) => useAppStore.getState().setPixelLabDirection(val)}
            style={{ width: '100%', marginTop: 12 }}
            options={['east', 'south', 'west', 'north', 'south-east', 'north-east', 'south-west', 'north-west'].map(v => ({ label: v, value: v }))}
          />
        </div>
      )}
    </div>
  );
}
