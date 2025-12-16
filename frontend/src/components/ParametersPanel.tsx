import { Slider, InputNumber, Row, Col, Typography } from 'antd';
import { useAppStore } from '../stores/appStore';

const { Title, Text } = Typography;

export default function ParametersPanel() {
  const { strength, count, setStrength, setCount } = useAppStore();

  return (
    <div>
      <Title level={5} style={{ marginBottom: 16 }}>参数设置</Title>
      
      <div style={{ marginBottom: 24 }}>
        <Text strong style={{ fontSize: 13 }}>重绘强度</Text>
        <Row gutter={12} align="middle" style={{ marginTop: 12 }}>
          <Col flex="auto">
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={strength}
              onChange={setStrength}
            />
          </Col>
          <Col>
            <InputNumber
              min={0}
              max={1}
              step={0.01}
              value={strength}
              onChange={(val) => setStrength(val || 0.5)}
              size="small"
              style={{ width: 65 }}
            />
          </Col>
        </Row>
      </div>

      <div>
        <Text strong style={{ fontSize: 13 }}>生成数量</Text>
        <Row gutter={12} align="middle" style={{ marginTop: 12 }}>
          <Col flex="auto">
            <Slider
              min={1}
              max={8}
              step={1}
              value={count}
              onChange={setCount}
              marks={{ 1: '1', 4: '4', 8: '8' }}
            />
          </Col>
          <Col>
            <InputNumber
              min={1}
              max={8}
              value={count}
              onChange={(val) => setCount(val || 1)}
              size="small"
              style={{ width: 65 }}
            />
          </Col>
        </Row>
      </div>
    </div>
  );
}
