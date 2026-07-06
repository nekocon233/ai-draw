import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Empty,
  InputNumber,
  Modal,
  Segmented,
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
  type VideoFrameOutput,
  type VideoFramePreviewItem,
} from '../api/services';
import { useBackgroundOptions } from '../hooks/useBackgroundOptions';
import BackgroundOptionsFields from './BackgroundOptionsFields';

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
  const bg = useBackgroundOptions();
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
    bg.reset();
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
        ...bg.toRequest(),
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
        link.download = `frames-${bg.state.background_mode}-${Date.now()}.zip`;
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

          <BackgroundOptionsFields opts={bg} />
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
