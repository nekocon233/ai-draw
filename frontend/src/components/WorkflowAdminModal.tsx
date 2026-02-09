import { useEffect, useMemo, useState } from 'react';
import { Modal, Table, Button, App, Form, Input, Switch, Upload, Space, Select, Divider, Popconfirm, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { apiService } from '../api/services';
import { isLoggedIn } from '../utils/helpers';
import type { InspectWorkflowNode, WorkflowDefinitionItem, WorkflowParameter } from '../types/api';

interface WorkflowAdminModalProps {
  open: boolean;
  onClose: () => void;
}

const VALUE_FROM_OPTIONS = [
  { label: 'prompt', value: 'prompt' },
  { label: 'lora_prompt', value: 'lora_prompt' },
  { label: 'seed', value: 'seed' },
  { label: 'strength', value: 'strength' },
  { label: 'width', value: 'width' },
  { label: 'height', value: 'height' },
  { label: 'uploaded_image_path', value: 'uploaded_image_path' },
];

const VALUE_TYPE_OPTIONS = [
  { label: 'str', value: 'str' },
  { label: 'int', value: 'int' },
  { label: 'float', value: 'float' },
  { label: 'bool', value: 'bool' },
];

function defaultParameters(requiresImage: boolean): WorkflowParameter[] {
  if (requiresImage) {
    return [
      { name: 'strength', label: '重绘强度', type: 'number', min: 0, max: 1, step: 0.01, default: 0.8 },
      { name: 'count', label: '生成数量', type: 'number', min: 1, max: 8, step: 1, default: 1 },
      { name: 'width', label: '图像宽度', type: 'number', min: 512, max: 2048, step: 64, default: 1024 },
      { name: 'height', label: '图像高度', type: 'number', min: 512, max: 2048, step: 64, default: 1024 },
      { name: 'lora_prompt', label: 'LoRA 提示词', type: 'text', default: '' },
    ];
  }
  return [
    { name: 'count', label: '生成数量', type: 'number', min: 1, max: 8, step: 1, default: 1 },
    { name: 'lora_prompt', label: 'LoRA 提示词', type: 'text', default: '' },
  ];
}

function defaultBindings(requiresImage: boolean) {
  const base = [
    { value_from: 'prompt', node_title: 'positive_prompt', input_name: 'positive', value_type: 'str' },
    { value_from: 'lora_prompt', node_title: 'lora_prompt', input_name: 'positive', value_type: 'str' },
    { value_from: 'seed', node_title: 'seed', input_name: 'value', value_type: 'int' },
  ];
  if (requiresImage) {
    return [
      ...base,
      { value_from: 'strength', node_title: 'denoise', input_name: 'value', value_type: 'float' },
      { value_from: 'width', node_title: 'width', input_name: 'value', value_type: 'int' },
      { value_from: 'height', node_title: 'height', input_name: 'value', value_type: 'int' },
      { value_from: 'uploaded_image_path', node_title: 'main_image', input_name: 'image', value_type: 'str' },
    ];
  }
  return base;
}

export default function WorkflowAdminModal({ open, onClose }: WorkflowAdminModalProps) {
  const { message } = App.useApp();
  const [items, setItems] = useState<WorkflowDefinitionItem[]>([]);
  const [loading, setLoading] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<WorkflowDefinitionItem | null>(null);
  const [workflowJson, setWorkflowJson] = useState<string>('');
  const [nodes, setNodes] = useState<InspectWorkflowNode[]>([]);
  const [parametersText, setParametersText] = useState<string>('[]');
  const [form] = Form.useForm();
  const [pendingFormValues, setPendingFormValues] = useState<any>(null);

  useEffect(() => {
    if (!editOpen || !pendingFormValues) return;
    form.setFieldsValue(pendingFormValues);
    setPendingFormValues(null);
  }, [editOpen, pendingFormValues, form]);

  const nodeOptions = useMemo(
    () => nodes.map(n => ({ label: n.node_title, value: n.node_title })),
    [nodes]
  );

  const refresh = async () => {
    if (!isLoggedIn()) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const res = await apiService.listWorkflowDefinitions();
      setItems(res.items || []);
    } catch (err: any) {
      message.error(err.message || '加载工作流失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      refresh();
    }
  }, [open]);

  const columns: ColumnsType<WorkflowDefinitionItem> = [
    { title: 'Key', dataIndex: 'key', width: 160 },
    { title: '名称', dataIndex: 'label', width: 220 },
    { title: '自定义', dataIndex: 'is_custom', width: 90, render: (v) => (v ? '是' : '否') },
    { title: '启用', dataIndex: 'enabled', width: 90, render: (v) => (v ? '是' : '否') },
    { title: '需参考图', dataIndex: 'requires_image', width: 110, render: (v) => (v ? '是' : '否') },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => openEdit(row)}>编辑</Button>
          <Popconfirm
            title={row.is_custom ? '确定删除该工作流？' : '确定禁用该工作流？'}
            okText="确定"
            cancelText="取消"
            onConfirm={() => handleDelete(row)}
          >
            <Button size="small" danger>{row.is_custom ? '删除' : '禁用'}</Button>
          </Popconfirm>
        </Space>
      )
    },
  ];

  const openCreate = () => {
    setEditing(null);
    setWorkflowJson('');
    setNodes([]);
    const init = {
      key: '',
      label: '',
      description: '',
      enabled: true,
      requires_image: false,
      output_node_title: '保存图像',
      bindings: defaultBindings(false),
    };
    setParametersText(JSON.stringify(defaultParameters(false), null, 2));
    setEditOpen(true);
    setPendingFormValues(init);
  };

  const openEdit = async (row: WorkflowDefinitionItem) => {
    try {
      const full = await apiService.getWorkflowDefinition(row.key);
      setEditing(full);
      setWorkflowJson(full.workflow_json || '');
      setNodes([]);
      setParametersText(JSON.stringify(full.parameters || [], null, 2));
      setEditOpen(true);
      setPendingFormValues({
        key: full.key,
        label: full.label,
        description: full.description,
        enabled: full.enabled,
        requires_image: full.requires_image,
        output_node_title: full.output_node_title || '保存图像',
        bindings: full.bindings || [],
      });
    } catch (err: any) {
      message.error(err.message || '加载工作流失败');
    }
  };

  const handleDelete = async (row: WorkflowDefinitionItem) => {
    try {
      await apiService.deleteWorkflowDefinition(row.key);
      message.success('已更新');
      refresh();
    } catch (err: any) {
      message.error(err.message || '操作失败');
    }
  };

  const handleUploadJson = async (file: File) => {
    try {
      const text = await file.text();
      setWorkflowJson(text);
      const inspect = await apiService.inspectWorkflow(file);
      setNodes(inspect.nodes || []);

      const saveNode = (inspect.nodes || []).find(n => n.class_type === 'SaveImage');
      if (saveNode) {
        form.setFieldsValue({ output_node_title: saveNode.node_title });
      }

      message.success('工作流已读取');
    } catch (err: any) {
      message.error(err.message || '读取工作流失败');
    }
    return false;
  };

  const applyRecommendedTemplate = () => {
    const requiresImage = !!form.getFieldValue('requires_image');
    const params = defaultParameters(requiresImage);
    setParametersText(JSON.stringify(params, null, 2));
    form.setFieldsValue({ bindings: defaultBindings(requiresImage) });
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      if (!workflowJson.trim()) {
        message.error('请先上传工作流 JSON');
        return;
      }

      let parameters: any[] = [];
      try {
        const parsed = JSON.parse(parametersText || '[]');
        parameters = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        message.error('参数配置不是合法 JSON');
        return;
      }

      const payload = {
        key: values.key,
        label: values.label,
        description: values.description,
        enabled: values.enabled,
        requires_image: values.requires_image,
        parameters,
        bindings: values.bindings || [],
        workflow_json: workflowJson,
        output_node_title: values.output_node_title,
      };

      if (editing) {
        await apiService.updateWorkflowDefinition(editing.key, payload);
      } else {
        await apiService.createWorkflowDefinition(payload);
      }

      message.success('已保存');
      setEditOpen(false);
      refresh();
    } catch (err: any) {
      message.error(err.message || '保存失败');
    }
  };

  return (
    <>
      <Modal
        title="工作流管理"
        open={open}
        onCancel={onClose}
        footer={[
          <Button key="refresh" onClick={refresh}>刷新</Button>,
          <Button key="close" type="primary" onClick={onClose}>关闭</Button>,
        ]}
        width={980}
        centered
        destroyOnHidden
      >
        {!isLoggedIn() ? (
          <Typography.Text type="secondary">需要登录后才能管理工作流</Typography.Text>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <Space>
                <Button onClick={async () => {
                  try {
                    await apiService.syncWorkflows();
                  } catch (err: any) {
                    message.error(err.message || '同步失败');
                  }
                  refresh();
                }}>
                  从目录同步
                </Button>
              </Space>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增工作流</Button>
            </div>
            <Table
              rowKey="key"
              columns={columns}
              dataSource={items}
              loading={loading}
              pagination={{ pageSize: 8 }}
              size="small"
            />
          </>
        )}
      </Modal>

      <Modal
        title={editing ? `编辑工作流：${editing.key}` : '新增工作流'}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={save}
        width={980}
        centered
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Space size={16} style={{ display: 'flex' }} align="start">
            <Form.Item label="Key" name="key" rules={[{ required: true, message: '请输入 key' }]} style={{ flex: 1 }}>
              <Input disabled={!!editing} placeholder="例如: my_custom_flow" />
            </Form.Item>
            <Form.Item label="启用" name="enabled" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item label="需要参考图" name="requires_image" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>

          <Space size={16} style={{ display: 'flex' }} align="start">
            <Form.Item label="名称" name="label" style={{ flex: 1 }}>
              <Input placeholder="展示名称" />
            </Form.Item>
            <Form.Item label="输出节点标题" name="output_node_title" style={{ width: 260 }}>
              <Input placeholder="默认：保存图像" />
            </Form.Item>
          </Space>

          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} />
          </Form.Item>

          <Form.Item label="上传工作流 JSON">
            <Upload
              accept=".json,application/json"
              maxCount={1}
              beforeUpload={handleUploadJson}
              showUploadList={false}
            >
              <Button icon={<UploadOutlined />}>选择文件</Button>
            </Upload>
            <Typography.Text type="secondary" style={{ marginLeft: 12 }}>
              已解析节点：{nodes.length}
            </Typography.Text>
          </Form.Item>

          <Divider style={{ margin: '12px 0' }} />

          <Space style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography.Text>参数配置（JSON）</Typography.Text>
            <Button size="small" onClick={applyRecommendedTemplate}>使用推荐模板</Button>
          </Space>
          <Input.TextArea
            value={parametersText}
            onChange={(e) => setParametersText(e.target.value)}
            rows={6}
            style={{ fontFamily: 'monospace' }}
          />

          <Divider style={{ margin: '12px 0' }} />

          <Typography.Text>Bindings（参数注入规则）</Typography.Text>
          <Form.List name="bindings">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => {
                  const selectedNodeTitle = form.getFieldValue(['bindings', field.name, 'node_title']);
                  const selectedNode = nodes.find(n => n.node_title === selectedNodeTitle);
                  const inputOptions = (selectedNode?.inputs || []).map(i => ({ label: i, value: i }));
                  return (
                    <Space key={field.key} style={{ display: 'flex', marginTop: 8 }} align="start">
                      <Form.Item name={[field.name, 'value_from']} rules={[{ required: true }]} style={{ width: 180 }}>
                        <Select options={VALUE_FROM_OPTIONS} placeholder="value_from" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'node_title']} rules={[{ required: true }]} style={{ width: 240 }}>
                        <Select options={nodeOptions} placeholder="node_title" showSearch optionFilterProp="label" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'input_name']} rules={[{ required: true }]} style={{ width: 220 }}>
                        <Select options={inputOptions} placeholder="input_name" showSearch />
                      </Form.Item>
                      <Form.Item name={[field.name, 'value_type']} style={{ width: 120 }}>
                        <Select options={VALUE_TYPE_OPTIONS} placeholder="type" />
                      </Form.Item>
                      <Button onClick={() => remove(field.name)}>移除</Button>
                    </Space>
                  );
                })}
                <div style={{ marginTop: 8 }}>
                  <Button icon={<PlusOutlined />} onClick={() => add()} block>
                    添加绑定
                  </Button>
                </div>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
    </>
  );
}
