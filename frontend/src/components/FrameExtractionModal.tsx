import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Empty,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Slider,
  Spin,
  message,
} from 'antd';
import {
  AppstoreOutlined,
  DownloadOutlined,
  ReloadOutlined,
  ScissorOutlined,
  SelectOutlined,
} from '@ant-design/icons';
import {
  apiService,
  type VideoBackgroundMode,
  type VideoFrameOutput,
  type VideoFramePreviewItem,
} from '../api/services';

interface FrameExtractionModalProps {
  open: boolean;
  videoUrl: string | null;
  initialOutput?: VideoFrameOutput;
  onClose: () => void;
  onSpritesheetGenerated?: (url: string, meta: { frames: number; cols?: number; rows?: number }) => void;
}

const DEFAULT_MAX_FRAMES = 64;

export default function FrameExtractionModal({
  open,
  videoUrl,
  initialOutput = 'zip',
  onClose,
  onSpritesheetGenerated,
}: FrameExtractionModalProps) {
  const [frames, setFrames] = useState<VideoFramePreviewItem[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [maxFrames, setMaxFrames] = useState(DEFAULT_MAX_FRAMES);
  const [fps, setFps] = useState<number | null>(null);
  const [output, setOutput] = useState<VideoFrameOutput>(initialOutput);
  const [backgroundMode, setBackgroundMode] = useState<VideoBackgroundMode>('inspyrenet');
  const [rembgModel, setRembgModel] = useState('isnet-anime');
  const [alphaMatting, setAlphaMatting] = useState(true);
  const [postProcessMask, setPostProcessMask] = useState(true);
  const [inspyrenetMode, setInspyrenetMode] = useState<'base' | 'fast' | 'base-nightly'>('base');
  const [inspyrenetResize, setInspyrenetResize] = useState<'static' | 'dynamic'>('static');
  const [birefnetModel, setBirefnetModel] = useState('ZhengPeng7/BiRefNet');
  const [birefnetImageSize, setBirefnetImageSize] = useState(1024);
  const [birefnetDevice, setBirefnetDevice] = useState('auto');
  const [birefnetPrecision, setBirefnetPrecision] = useState<'auto' | 'fp32' | 'fp16' | 'bf16'>('auto');
  const [edgeThreshold, setEdgeThreshold] = useState(32);
  const [edgeFeather, setEdgeFeather] = useState(10);
  const [cols, setCols] = useState<number | null>(null);

  const selectedFrames = useMemo(
    () => frames.filter(frame => selected.has(frame.index)),
    [frames, selected]
  );

  const previewMeta = useMemo(() => {
    if (!frames.length) return '';
    const first = frames[0];
    return `${frames.length} 帧 · ${first.width}×${first.height}`;
  }, [frames]);

  const loadPreview = useCallback(async (limit: number, rate: number | null) => {
    if (!videoUrl) return;
    setLoadingPreview(true);
    try {
      const res = await apiService.videoFramePreview({
        video_url: videoUrl,
        max_frames: limit,
        fps: rate || undefined,
      });
      setFrames(res.frames);
      setSelected(new Set(res.frames.map(frame => frame.index)));
    } catch (err: any) {
      message.error(err?.message || '预览帧抽取失败');
    } finally {
      setLoadingPreview(false);
    }
  }, [videoUrl]);

  useEffect(() => {
    if (!open || !videoUrl) return;
    setFrames([]);
    setSelected(new Set());
    setMaxFrames(DEFAULT_MAX_FRAMES);
    setFps(null);
    setOutput(initialOutput);
    setBackgroundMode('inspyrenet');
    setRembgModel('isnet-anime');
    setAlphaMatting(true);
    setPostProcessMask(true);
    setInspyrenetMode('base');
    setInspyrenetResize('static');
    setBirefnetModel('ZhengPeng7/BiRefNet');
    setBirefnetImageSize(1024);
    setBirefnetDevice('auto');
    setBirefnetPrecision('auto');
    setEdgeThreshold(32);
    setEdgeFeather(10);
    setCols(null);
    void loadPreview(DEFAULT_MAX_FRAMES, null);
  }, [initialOutput, loadPreview, open, videoUrl]);

  const toggleFrame = (index: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(frames.map(frame => frame.index)));
  };

  const invertSelection = () => {
    setSelected(prev => {
      const next = new Set<number>();
      frames.forEach(frame => {
        if (!prev.has(frame.index)) next.add(frame.index);
      });
      return next;
    });
  };

  const exportFrames = async () => {
    if (!selectedFrames.length) {
      message.warning('请至少选择一帧');
      return;
    }

    setExporting(true);
    try {
      const res = await apiService.exportVideoFrames({
        frame_urls: selectedFrames.map(frame => frame.url),
        output,
        cols: output === 'spritesheet' ? cols || undefined : undefined,
        background_mode: backgroundMode,
        rembg_model: rembgModel,
        alpha_matting: alphaMatting,
        post_process_mask: postProcessMask,
        inspyrenet_mode: inspyrenetMode,
        inspyrenet_resize: inspyrenetResize,
        birefnet_model: birefnetModel,
        birefnet_image_size: birefnetImageSize,
        birefnet_device: birefnetDevice,
        birefnet_precision: birefnetPrecision,
        edge_threshold: edgeThreshold,
        edge_feather: edgeFeather,
      });

      if (output === 'spritesheet' && res.spritesheet_url) {
        onSpritesheetGenerated?.(res.spritesheet_url, {
          frames: res.frames,
          cols: res.cols,
          rows: res.rows,
        });
        message.success(`精灵图已生成（${res.frames} 帧），已追加到结果区`);
        onClose();
        return;
      }

      if (res.zip_url) {
        const link = document.createElement('a');
        link.href = res.zip_url;
        link.download = `frames-${backgroundMode}-${Date.now()}.zip`;
        link.click();
        message.success(`已导出 ${res.frames} 帧`);
      }
    } catch (err: any) {
      message.error(err?.message || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal
      title="抽帧编辑"
      open={open}
      onCancel={onClose}
      width={1080}
      className="frame-editor-modal"
      destroyOnHidden
      footer={[
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
        <Button
          key="preview"
          icon={<ReloadOutlined />}
          loading={loadingPreview}
          onClick={() => loadPreview(maxFrames, fps)}
        >
          重新预览
        </Button>,
        <Button
          key="export"
          type="primary"
          icon={output === 'spritesheet' ? <AppstoreOutlined /> : <DownloadOutlined />}
          loading={exporting}
          disabled={!selectedFrames.length || loadingPreview}
          onClick={exportFrames}
        >
          {output === 'spritesheet' ? '生成精灵图' : '导出 ZIP'}
        </Button>,
      ]}
    >
      <div className="frame-editor-layout">
        <div className="frame-editor-controls">
          <div className="frame-editor-section">
            <div className="frame-editor-section-title">抽帧</div>
            <label className="frame-editor-field">
              <span>最多帧数</span>
              <InputNumber
                min={1}
                max={600}
                value={maxFrames}
                onChange={value => setMaxFrames(typeof value === 'number' ? value : DEFAULT_MAX_FRAMES)}
              />
            </label>
            <label className="frame-editor-field">
              <span>帧率</span>
              <InputNumber
                min={0.1}
                max={60}
                step={0.5}
                value={fps ?? undefined}
                placeholder="原帧率"
                onChange={value => setFps(typeof value === 'number' ? value : null)}
              />
            </label>
          </div>

          <div className="frame-editor-section">
            <div className="frame-editor-section-title">导出</div>
            <Segmented
              block
              value={output}
              onChange={value => setOutput(value as VideoFrameOutput)}
              options={[
                { label: 'ZIP', value: 'zip', icon: <ScissorOutlined /> },
                { label: '精灵图', value: 'spritesheet', icon: <AppstoreOutlined /> },
              ]}
            />
            {output === 'spritesheet' && (
              <label className="frame-editor-field">
                <span>列数</span>
                <InputNumber
                  min={1}
                  max={32}
                  value={cols ?? undefined}
                  placeholder="自动"
                  onChange={value => setCols(typeof value === 'number' ? value : null)}
                />
              </label>
            )}
          </div>

          <div className="frame-editor-section">
            <div className="frame-editor-section-title">背景</div>
            <Select
              value={backgroundMode}
              onChange={setBackgroundMode}
              options={[
                { value: 'inspyrenet', label: 'InSPyReNet' },
                { value: 'birefnet', label: 'BiRefNet' },
                { value: 'ai', label: 'rembg' },
                { value: 'edge', label: '边缘色' },
                { value: 'none', label: '原背景' },
              ]}
            />

            {backgroundMode === 'inspyrenet' && (
              <>
                <label className="frame-editor-field">
                  <span>模式</span>
                  <Select
                    value={inspyrenetMode}
                    onChange={setInspyrenetMode}
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
                    value={inspyrenetResize}
                    onChange={setInspyrenetResize}
                    options={[
                      { value: 'static', label: 'static' },
                      { value: 'dynamic', label: 'dynamic' },
                    ]}
                  />
                </label>
              </>
            )}

            {backgroundMode === 'birefnet' && (
              <>
                <label className="frame-editor-field">
                  <span>模型</span>
                  <Select
                    value={birefnetModel}
                    onChange={setBirefnetModel}
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
                    value={birefnetImageSize}
                    onChange={value => setBirefnetImageSize(typeof value === 'number' ? value : 1024)}
                  />
                </label>
                <label className="frame-editor-field">
                  <span>设备</span>
                  <Select
                    value={birefnetDevice}
                    onChange={setBirefnetDevice}
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
                    value={birefnetPrecision}
                    onChange={setBirefnetPrecision}
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

            {backgroundMode === 'ai' && (
              <>
                <label className="frame-editor-field">
                  <span>模型</span>
                  <Select
                    value={rembgModel}
                    onChange={setRembgModel}
                    options={[
                      { value: 'isnet-anime', label: 'isnet-anime' },
                      { value: 'isnet-general-use', label: 'isnet-general-use' },
                      { value: 'u2net', label: 'u2net' },
                      { value: 'u2netp', label: 'u2netp' },
                      { value: 'u2net_human_seg', label: 'u2net_human_seg' },
                    ]}
                  />
                </label>
                <Checkbox checked={alphaMatting} onChange={e => setAlphaMatting(e.target.checked)}>
                  Alpha matting
                </Checkbox>
                <Checkbox checked={postProcessMask} onChange={e => setPostProcessMask(e.target.checked)}>
                  Mask 后处理
                </Checkbox>
              </>
            )}

            {backgroundMode === 'edge' && (
              <>
                <div className="frame-editor-slider">
                  <span>容差 {edgeThreshold}</span>
                  <Slider min={0} max={96} value={edgeThreshold} onChange={setEdgeThreshold} />
                </div>
                <div className="frame-editor-slider">
                  <span>柔化 {edgeFeather}</span>
                  <Slider min={1} max={40} value={edgeFeather} onChange={setEdgeFeather} />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="frame-editor-main">
          <div className="frame-editor-toolbar">
            <div className="frame-editor-count">
              <span>{previewMeta || '未加载帧'}</span>
              <span>已选 {selectedFrames.length}</span>
            </div>
            <div className="frame-editor-toolbar-actions">
              <Button size="small" icon={<SelectOutlined />} onClick={selectAll} disabled={!frames.length}>
                全选
              </Button>
              <Button size="small" onClick={invertSelection} disabled={!frames.length}>
                反选
              </Button>
            </div>
          </div>

          <Spin spinning={loadingPreview}>
            {frames.length ? (
              <div className="frame-editor-grid">
                {frames.map(frame => {
                  const isSelected = selected.has(frame.index);
                  return (
                    <div
                      key={frame.url}
                      role="button"
                      tabIndex={0}
                      className={`frame-editor-tile ${isSelected ? 'selected' : ''}`}
                      onClick={() => toggleFrame(frame.index)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          toggleFrame(frame.index);
                        }
                      }}
                    >
                      <img src={frame.url} alt={`frame ${frame.index + 1}`} />
                      <span className="frame-editor-index">{frame.index + 1}</span>
                      <span className="frame-editor-check">
                        <Checkbox
                          checked={isSelected}
                          onClick={event => event.stopPropagation()}
                          onChange={() => toggleFrame(frame.index)}
                        />
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="frame-editor-empty">
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无预览帧" />
              </div>
            )}
          </Spin>
        </div>
      </div>
    </Modal>
  );
}
