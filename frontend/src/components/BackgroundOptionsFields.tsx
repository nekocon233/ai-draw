/**
 * 背景抠除选项 UI（共享）
 *
 * 由 useBackgroundOptions 驱动，FrameExtractionModal 与 BackgroundRemovalModal 共用，
 * 复用 .frame-editor-* 样式。
 */
import { Checkbox, InputNumber, Select, Slider } from 'antd';
import type { useBackgroundOptions } from '../hooks/useBackgroundOptions';

interface BackgroundOptionsFieldsProps {
  opts: ReturnType<typeof useBackgroundOptions>;
  title?: string;
  /** true：标题作为行内 label 与模式下拉框同一行（窄弹窗用）；false：标题作为区块标题独占一行（默认） */
  inline?: boolean;
}

export default function BackgroundOptionsFields({ opts, title = '背景', inline = false }: BackgroundOptionsFieldsProps) {
  const { state, set } = opts;

  const modeSelect = (
    <Select
      value={state.background_mode}
      onChange={value => set('background_mode', value)}
      options={[
        { value: 'inspyrenet', label: 'InSPyReNet' },
        { value: 'birefnet', label: 'BiRefNet' },
        { value: 'ai', label: 'rembg' },
        { value: 'edge', label: '边缘色' },
        { value: 'none', label: '原背景' },
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
              onChange={value => set('inspyrenet_mode', value)}
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
              onChange={value => set('inspyrenet_resize', value)}
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
              onChange={value => set('birefnet_model', value)}
              options={[
                { value: 'ZhengPeng7/BiRefNet', label: 'BiRefNet' },
                { value: 'ZhengPeng7/BiRefNet_HR-matting', label: 'HR-matting' },
                { value: 'ZhengPeng7/BiRefNet_dynamic', label: 'dynamic' },
                { value: 'ZhengPeng7/BiRefNet-matting', label: 'matting' },
              ]}
            />
          </label>
          <label className="frame-editor-field">
            <span>尺寸</span>
            <InputNumber
              min={256}
              max={2304}
              step={128}
              value={state.birefnet_image_size}
              onChange={value => set('birefnet_image_size', typeof value === 'number' ? value : 1024)}
            />
          </label>
          <label className="frame-editor-field">
            <span>设备</span>
            <Select
              value={state.birefnet_device}
              onChange={value => set('birefnet_device', value)}
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
              onChange={value => set('birefnet_precision', value)}
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
              onChange={value => set('rembg_model', value)}
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
            onChange={e => set('alpha_matting', e.target.checked)}
          >
            Alpha matting
          </Checkbox>
          <Checkbox
            checked={state.post_process_mask}
            onChange={e => set('post_process_mask', e.target.checked)}
          >
            Mask 后处理
          </Checkbox>
        </>
      )}

      {state.background_mode === 'edge' && (
        <>
          <div className="frame-editor-slider">
            <span>容差 {state.edge_threshold}</span>
            <Slider
              min={0}
              max={96}
              value={state.edge_threshold}
              onChange={value => set('edge_threshold', value)}
            />
          </div>
          <div className="frame-editor-slider">
            <span>柔化 {state.edge_feather}</span>
            <Slider
              min={1}
              max={40}
              value={state.edge_feather}
              onChange={value => set('edge_feather', value)}
            />
          </div>
        </>
      )}
    </div>
  );
}
