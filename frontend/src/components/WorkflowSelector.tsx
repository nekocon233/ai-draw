import { Radio, Space, Typography } from 'antd';
import { useAppStore } from '../stores/appStore';
import { apiService } from '../api/services';
import { useEffect, useState } from 'react';

const { Title } = Typography;

export default function WorkflowSelector() {
  const { currentWorkflow, setCurrentWorkflow, setError } = useAppStore();
  const [workflows, setWorkflows] = useState<string[]>([]);

  useEffect(() => {
    apiService.getWorkflows()
      .then(res => setWorkflows(res.workflows))
      .catch(err => setError(err.message));
  }, [setError]);

  const handleChange = async (workflow: string) => {
    try {
      await apiService.switchWorkflow(workflow);
      setCurrentWorkflow(workflow);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div>
      <Title level={5} style={{ marginBottom: 16 }}>工作流</Title>
      <Radio.Group
        value={currentWorkflow}
        onChange={(e) => handleChange(e.target.value)}
        style={{ width: '100%' }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          {workflows.map(workflow => (
            <Radio key={workflow} value={workflow} style={{ width: '100%' }}>
              {workflow}
            </Radio>
          ))}
        </Space>
      </Radio.Group>
    </div>
  );
}
