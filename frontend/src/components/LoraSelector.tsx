import { useEffect, useReducer, useState } from 'react';
import { Alert, Button, Select, Slider } from 'antd';
import { CloseOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';
import { apiService } from '../api/services';
import type { LoraModelsResponse } from '../types/api';
import { clampLoraPromptStrengths, parseLoraPrompt, serializeLoraSelections, type LoraSelection } from '../utils/loraOptions';

interface LoraSelectorProps {
  id?: string;
  workflow: string;
  value?: string;
  onChange?: (value: string) => void;
}

export default function LoraSelector({ id, workflow, value = '', onChange }: LoraSelectorProps) {
  const [inventory, setInventory] = useState<(LoraModelsResponse & { error?: string }) | null>(null);
  const [reloadKey, reload] = useReducer((key: number) => key + 1, 0);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const currentInventory = inventory?.workflow === workflow ? inventory : null;
  const models = currentInventory?.models ?? [];
  const loading = !currentInventory;
  const { selections, unparsed } = parseLoraPrompt(clampLoraPromptStrengths(value));
  const rows = selections.length ? selections : [{ name: '', strength: 0.8 }];
  const disabled = loading || !!currentInventory?.error || !!unparsed;

  useEffect(() => {
    let active = true;
    apiService.getLoraModels(workflow).then(result => {
      if (active) setInventory(result);
    }).catch(() => {
      if (active) setInventory({ workflow, models: [], error: '暂时无法获取 LoRA 列表，已保留当前选择。' });
    });
    return () => { active = false; };
  }, [workflow, reloadKey]);

  const update = (next: LoraSelection[]) => onChange?.(clampLoraPromptStrengths(serializeLoraSelections(next)));
  const remainingModels = models.filter(model => !selections.some(item => item.name === model.value));
  const unavailable = !loading && !currentInventory?.error
    && selections.some(item => !models.some(model => model.value === item.name));

  return (
    <div className="lora-selector">
      {unparsed && (
        <Alert type="warning" title="原有 LoRA 配置需要重新选择，未自动改动。"
          action={<Button size="small" onClick={() => onChange?.('')}>重新选择</Button>} />
      )}
      {currentInventory?.error && (
        <Alert type="warning" title={currentInventory.error}
          action={<Button size="small" onClick={() => { setInventory(null); reload(); }}>重试</Button>} />
      )}
      {unavailable && <Alert type="warning" title="已保存的 LoRA 未安装或不适用于此工作流，请选择其他模型。" />}
      {rows.map((selection, index) => {
        const isOpen = openIndex === index && !disabled;
        const options = models.map(model => ({
          label: model.label,
          value: model.value,
          disabled: selections.some((item, position) => position !== index && item.name === model.value),
        }));
        options.unshift({ label: '不使用 LoRA', value: '', disabled: false });
        if (selection.name && !models.some(model => model.value === selection.name)) {
          options.push({ label: `${selection.name}（${loading ? '正在查询' : '不可用'}）`, value: selection.name, disabled: true });
        }
        return (
          <div className={`lora-selector-row${selection.name ? '' : ' lora-selector-row-empty'}`} key={index}>
            <div className="lora-selector-model">
              <Select
                id={index === 0 ? id : undefined}
                className="lora-model-select"
                aria-label={`LoRA ${index + 1}`}
                showSearch={{ optionFilterProp: 'label' }}
                open={isOpen}
                onOpenChange={open => setOpenIndex(current => open ? index : current === index ? null : current)}
                suffixIcon={
                  <button
                    type="button"
                    className="lora-dropdown-toggle"
                    aria-label={`${isOpen ? '收起' : '展开'} LoRA ${index + 1} 列表`}
                    aria-expanded={isOpen}
                    aria-haspopup="listbox"
                    disabled={disabled}
                    onMouseDown={event => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
                    }}
                    onClick={event => {
                      event.stopPropagation();
                      setOpenIndex(current => current === index ? null : index);
                    }}
                  >
                    {isOpen ? <UpOutlined aria-hidden="true" /> : <DownOutlined aria-hidden="true" />}
                  </button>
                }
                placeholder="选择风格 LoRA"
                value={selection.name}
                options={options}
                loading={loading}
                disabled={disabled}
                notFoundContent="暂无适配此工作流的已安装 LoRA"
                onChange={name => {
                  setOpenIndex(null);
                  const next = [...selections];
                  // 换模型时保留这一行已调好的强度，空行首次选择才用该模型的默认强度
                  const strength = selection.name ? selection.strength : models.find(model => model.value === name)?.default_strength ?? 0.8;
                  if (name) next[index] = { name, strength };
                  else next.splice(index, 1);
                  update(next);
                }}
              />
            </div>
            {selection.name && <div className="lora-selector-strength">
              <span>强度</span>
              <Slider
                ariaLabelForHandle={`LoRA ${index + 1} 强度`}
                min={0}
                max={1}
                step={0.05}
                value={selection.strength}
                tooltip={{ formatter: strength => strength?.toFixed(2) }}
                disabled={disabled || !selection.name}
                onChange={strength => update(selections.map((item, position) => position === index ? { ...item, strength } : item))}
              />
            </div>}
            {selection.name && (
              <Button className="lora-remove" type="text" size="small" icon={<CloseOutlined />}
                title={`移除 LoRA ${index + 1}`} aria-label={`移除 LoRA ${index + 1}`} disabled={!!unparsed}
                onClick={() => {
                  setOpenIndex(null);
                  update(selections.filter((_, position) => position !== index));
                }} />
            )}
          </div>
        );
      })}
      {selections.length > 0 && remainingModels.length > 0 && (
        <Button size="small" disabled={disabled || remainingModels.length === 0}
          onClick={() => {
            const model = remainingModels[0];
            if (model) update([...selections, { name: model.value, strength: model.default_strength }]);
          }}>添加 LoRA</Button>
      )}
    </div>
  );
}
