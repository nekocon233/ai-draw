import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { BulbOutlined, LoadingOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import type { PromptPreset, WorkflowMetadata } from '../types/api';
import { getPresetWorkflowBlocker, getWorkflowPresets } from '../utils/imageMentions';
import './PromptPresetQuickSelect.css';

interface PromptPresetQuickSelectProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset: PromptPreset | null;
  workflowMeta?: WorkflowMetadata;
  onChange: (preset: PromptPreset | null) => void;
  onGeneratePrompt?: () => void;
  generatingPrompt?: boolean;
  generatePromptDisabled?: boolean;
  generatePromptBlockedReason?: string | null;
}

export default function PromptPresetQuickSelect({ open, onOpenChange, preset, workflowMeta, onChange, onGeneratePrompt, generatingPrompt = false, generatePromptDisabled = false, generatePromptBlockedReason }: PromptPresetQuickSelectProps) {
  const [presets, setPresets] = useState<PromptPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestVersion = useRef(0);

  useEffect(() => () => { requestVersion.current += 1; }, []);

  const loadPresets = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setFailed(false);
    try {
      const response = await useAppStore.getState().loadPromptPresets();
      if (version === requestVersion.current) setPresets(response);
    } catch {
      if (version === requestVersion.current) setFailed(true);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void loadPresets();
  }, [open, loadPresets]);

  const availablePresets = getWorkflowPresets(presets, workflowMeta);
  const presetItems: MenuProps['items'] = loading
    ? [{ key: 'loading', disabled: true, icon: <LoadingOutlined />, label: '正在加载预设…' }]
    : failed
      ? [{ key: 'retry', icon: <ReloadOutlined />, label: '加载失败，点击重试' }]
      : availablePresets.length === 0
        ? [{ key: 'empty', disabled: true, label: '当前工作流暂无可用预设' }]
        : availablePresets.map(item => {
          const blocker = getPresetWorkflowBlocker(item, workflowMeta);
          return {
            key: `preset:${item.id}`,
            disabled: Boolean(blocker),
            title: blocker ?? item.description,
            label: (
              <span className="prompt-preset-quick-option">
                <span className="prompt-preset-quick-heading">
                  <strong>{item.title}</strong>
                  {item.requires_motion_reference
                    ? <span>{item.motion_reference_mode === 'shot' ? '主体图＋参考图' : '原图＋动作图'}</span>
                    : item.images.length > 0 && <span>{item.images.length} 张{item.output_type === 'video' ? '关键帧' : '参考图'}</span>}
                </span>
                <span className="prompt-preset-quick-description">{blocker ?? item.description}</span>
              </span>
            ),
          };
        });

  const select: MenuProps['onClick'] = ({ key }) => {
    if (key === 'generate-prompt') {
      if (!onGeneratePrompt || generatingPrompt || generatePromptDisabled || generatePromptBlockedReason) return;
      onOpenChange(false);
      onGeneratePrompt();
      return;
    }
    if (key === 'retry') { void loadPresets(); return; }
    if (key === 'none') {
      onOpenChange(false);
      onChange(null);
      return;
    }
    const selected = availablePresets.find(item => `preset:${item.id}` === key);
    if (!selected || getPresetWorkflowBlocker(selected, workflowMeta)) return;
    onOpenChange(false);
    onChange(selected);
  };

  return (
    <Dropdown
      open={open}
      onOpenChange={(next, info) => {
        if (info.source === 'menu') return;
        onOpenChange(next);
      }}
      trigger={['click']}
      placement="topLeft"
      align={{ overflow: { shiftX: true, adjustY: true } }}
      menu={{
        className: 'prompt-preset-quick-menu',
        selectable: true,
        selectedKeys: [preset ? `preset:${preset.id}` : 'none'],
        onClick: select,
        items: [
          ...(onGeneratePrompt ? [{ key: 'generate-prompt', icon: generatingPrompt ? <LoadingOutlined /> : <BulbOutlined />,
            label: generatingPrompt ? '正在生成提示词…' : '生成提示词', title: generatePromptBlockedReason ?? undefined,
            disabled: generatingPrompt || generatePromptDisabled || Boolean(generatePromptBlockedReason) }, { type: 'divider' as const }] : []),
          { key: 'none', label: '不使用预设' }, { type: 'divider' }, ...presetItems,
        ],
      }}
    >
      <Button
        type="text"
        size="small"
        className="prompt-preset-quick-trigger"
        icon={generatingPrompt ? <LoadingOutlined aria-hidden="true" /> : <PlusOutlined aria-hidden="true" />}
        title={onGeneratePrompt ? '更多操作' : '添加预设'}
        aria-label={onGeneratePrompt ? '更多操作' : '添加预设'}
        aria-busy={generatingPrompt}
        aria-haspopup="menu"
        aria-expanded={open}
      />
    </Dropdown>
  );
}
