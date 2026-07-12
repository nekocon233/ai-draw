/**
 * 背景抠除选项 UI（共享）
 *
 * 由 useBackgroundOptions 驱动，视频帧与聊天结果的图片编辑器共用，
 * 复用 .frame-editor-* 样式。
 */
import { Checkbox, Select } from 'antd';
import type { BackgroundOptionsState, useBackgroundOptions } from '../hooks/useBackgroundOptions';

interface BackgroundOptionsFieldsProps {
  opts: ReturnType<typeof useBackgroundOptions>;
  title?: string;
  /** true：标题作为行内 label 与模式下拉框同一行（窄弹窗用）；false：标题作为区块标题独占一行（默认） */
  inline?: boolean;
  onChange?: () => void;
}

export default function BackgroundOptionsFields({ opts, title = '背景', inline = false, onChange }: BackgroundOptionsFieldsProps) {
  const { state, set } = opts;

  function updateOption<K extends keyof BackgroundOptionsState>(key: K, value: BackgroundOptionsState[K]) {
    set(key, value);
    onChange?.();
  }

  const modeSelect = (
    <Select
      value={state.background_mode}
      onChange={value => updateOption('background_mode', value)}
      options={[
        { value: 'inspyrenet', label: 'InSPyReNet' },
        { value: 'birefnet', label: 'BiRefNet' },
        { value: 'ai', label: 'rembg' },
      ]}
    />
  );

  return (
    <div className="frame-editor-section">
      {inline ? (
        <label className="frame-editor-field">
          <span>{title}</span>
          {modeSelect}
        </label>
      ) : (
        <>
          <div className="frame-editor-section-title">{title}</div>
          {modeSelect}
        </>
      )}

      {state.background_mode === 'inspyrenet' && (
        <>
          <label className="frame-editor-field">
            <span>模式</span>
            <Select
              value={state.inspyrenet_mode}
              onChange={value => updateOption('inspyrenet_mode', value)}
              options={[
                { value: 'base', label: 'base' },
                { value: 'fast', label: 'fast' },
                { value: 'base-nightly', label: 'base-nightly' },
              ]}
            />
          </label>
          <label className="frame-editor-field">
            <span>尺寸</span>
            <Select
              value={state.inspyrenet_resize}
              onChange={value => updateOption('inspyrenet_resize', value)}
              options={[
                { value: 'static', label: 'static' },
                { value: 'dynamic', label: 'dynamic' },
              ]}
            />
          </label>
        </>
      )}

      {state.background_mode === 'birefnet' && (
        <>
          <label className="frame-editor-field">
            <span>模型</span>
            <Select
              value={state.birefnet_model}
              onChange={value => updateOption('birefnet_model', value)}
              options={[
                { value: 'ZhengPeng7/BiRefNet', label: 'BiRefNet' },
                { value: 'joelseytre/toonout', label: 'ToonOut（动漫专用）' },
                { value: 'ZhengPeng7/BiRefNet_HR-matting', label: 'HR-matting' },
                { value: 'ZhengPeng7/BiRefNet_dynamic', label: 'dynamic' },
                { value: 'ZhengPeng7/BiRefNet-matting', label: 'matting' },
              ]}
            />
          </label>
          <label className="frame-editor-field">
            <span>设备</span>
            <Select
              value={state.birefnet_device}
              onChange={value => updateOption('birefnet_device', value)}
              options={[
                { value: 'auto', label: 'auto' },
                { value: 'cuda', label: 'cuda' },
                { value: 'cpu', label: 'cpu' },
              ]}
            />
          </label>
          <label className="frame-editor-field">
            <span>精度</span>
            <Select
              value={state.birefnet_precision}
              onChange={value => updateOption('birefnet_precision', value)}
              options={[
                { value: 'auto', label: 'auto' },
                { value: 'fp32', label: 'fp32' },
                { value: 'fp16', label: 'fp16' },
                { value: 'bf16', label: 'bf16' },
              ]}
            />
          </label>
        </>
      )}

      {state.background_mode === 'ai' && (
        <>
          <label className="frame-editor-field">
            <span>模型</span>
            <Select
              value={state.rembg_model}
              onChange={value => updateOption('rembg_model', value)}
              options={[
                { value: 'isnet-anime', label: 'isnet-anime' },
                { value: 'isnet-general-use', label: 'isnet-general-use' },
                { value: 'u2net', label: 'u2net' },
                { value: 'u2netp', label: 'u2netp' },
                { value: 'u2net_human_seg', label: 'u2net_human_seg' },
              ]}
            />
          </label>
          <Checkbox
            checked={state.alpha_matting}
            onChange={e => updateOption('alpha_matting', e.target.checked)}
          >
            Alpha matting
          </Checkbox>
          <Checkbox
            checked={state.post_process_mask}
            onChange={e => updateOption('post_process_mask', e.target.checked)}
          >
            Mask 后处理
          </Checkbox>
        </>
      )}
    </div>
  );
}
