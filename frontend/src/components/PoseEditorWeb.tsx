import { useEffect, useRef, useState } from 'react';
import { Modal, Button, Typography, message } from 'antd';
import { CameraOutlined, DownloadOutlined, ExportOutlined, QuestionCircleOutlined, ReloadOutlined, UpOutlined } from '@ant-design/icons';
import { apiService } from '../api/services';
import './PoseEditorWeb.css';

const POSE_EDITOR_URL = 'https://posemy.art/app/?lang=zhHans';
const EXTENSION_STORE_URL = 'https://chromewebstore.google.com/detail/ignore-x-frame-headers/gleekbfjekiniecknbkamfmkohkpodhe';

interface PoseEditorWebProps {
  open: boolean;
  onClose: () => void;
  targetSlot?: 1 | 2 | 3;
  targetLabel?: string;
  onApplyImage?: (base64: string) => void;
}

export default function PoseEditorWeb({ open, onClose, targetSlot = 1, targetLabel, onApplyImage }: PoseEditorWebProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [frameVersion, setFrameVersion] = useState(0);
  const [embeddingStatus, setEmbeddingStatus] = useState<'checking' | 'enabled' | 'disabled' | 'unknown'>('checking');
  const lastEmbeddingCheck = useRef<boolean | null>(null);
  const [guideOverride, setGuideOverride] = useState<boolean | null>(null);
  const showInstallGuide = guideOverride ?? (embeddingStatus === 'disabled' || embeddingStatus === 'unknown');

  useEffect(() => {
    if (!open || isCapturing) return;
    let disposed = false;
    let revision = 0;
    const check = async () => {
      const current = ++revision;
      let enabled: boolean | null = null;
      try {
        enabled = await apiService.checkPoseEmbedding();
      } catch {
        // Keep the guide available if support cannot be confirmed.
      }
      if (!disposed && current === revision) {
        const previouslyEnabled = lastEmbeddingCheck.current;
        if (enabled !== null) lastEmbeddingCheck.current = enabled;
        setEmbeddingStatus(enabled === null ? 'unknown' : enabled ? 'enabled' : 'disabled');
        if (enabled && previouslyEnabled === false) setFrameVersion(version => version + 1);
      }
    };
    void check();
    window.addEventListener('focus', check);
    return () => {
      disposed = true;
      window.removeEventListener('focus', check);
    };
  }, [open, frameVersion, isCapturing]);

  const reloadEditor = () => {
    setGuideOverride(null);
    setFrameVersion(version => version + 1);
  };

  const handleCapture = async () => {
    setIsCapturing(true);
    try {
      const mediaDevicesGetDisplayMedia = navigator.mediaDevices?.getDisplayMedia?.bind(navigator.mediaDevices);
      const legacyNavigator = navigator as Navigator & {
        getDisplayMedia?: (constraints?: MediaStreamConstraints | Record<string, unknown>) => Promise<MediaStream>;
        webkitGetDisplayMedia?: (constraints?: MediaStreamConstraints | Record<string, unknown>) => Promise<MediaStream>;
      };
      const legacyGetDisplayMedia = legacyNavigator.getDisplayMedia?.bind(navigator)
        || legacyNavigator.webkitGetDisplayMedia?.bind(navigator);
      const getDisplayMedia = mediaDevicesGetDisplayMedia || legacyGetDisplayMedia;

      if (!getDisplayMedia) {
        console.warn('[PoseEditorWeb] getDisplayMedia unavailable', {
          isSecureContext: window.isSecureContext,
          origin: window.location.origin,
          hasMediaDevices: Boolean(navigator.mediaDevices),
          hasMediaDevicesGetDisplayMedia: typeof navigator.mediaDevices?.getDisplayMedia === 'function',
          hasLegacyGetDisplayMedia: typeof legacyNavigator.getDisplayMedia === 'function',
        });

        if (!window.isSecureContext) {
          message.error('当前页面不是安全上下文，请使用 HTTPS 或 localhost 地址访问后再截图。');
        } else {
          message.error('浏览器屏幕共享接口不可用，请检查站点权限后重试。');
        }
        return;
      }

      if (!iframeRef.current) {
        message.error('截图区域未就绪，请重试。');
        return;
      }

      // 请求屏幕共享，preferCurrentTab/selfBrowserSurface 可提升 Chrome 下选择当前标签页的体验
      const stream = await getDisplayMedia({
        video: true,
        audio: false,
        // @ts-expect-error preferCurrentTab 是 Chrome 扩展属性，非标准类型
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
      });

      const track = stream.getVideoTracks()[0];
      if (!track) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error('未获取到视频轨道');
      }
      const settings = track.getSettings();
      const { width: vidW = 1920, height: vidH = 1080 } = settings;

      // 把视频帧绘制到全屏 canvas
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();

      const fullCanvas = document.createElement('canvas');
      fullCanvas.width = vidW;
      fullCanvas.height = vidH;
      fullCanvas.getContext('2d')!.drawImage(video, 0, 0, vidW, vidH);
      video.pause();
      track.stop();
      stream.getTracks().forEach(t => t.stop());

      // 计算 iframe 在视口中的位置，换算到物理像素
      const dpr = window.devicePixelRatio || 1;
      const rect = iframeRef.current!.getBoundingClientRect();

      // 视频宽高 vs 窗口宽高的缩放比（getDisplayMedia 拍整个浏览器时需要考虑）
      const scaleX = vidW / window.innerWidth;
      const scaleY = vidH / window.innerHeight;

      const sx = Math.round(rect.left * scaleX * dpr / dpr);
      const sy = Math.round(rect.top  * scaleY * dpr / dpr);
      const sw = Math.round(rect.width  * scaleX * dpr / dpr);
      const sh = Math.round(rect.height * scaleY * dpr / dpr);

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width  = sw;
      cropCanvas.height = sh;
      cropCanvas.getContext('2d')!.drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

      const base64 = cropCanvas.toDataURL('image/png');
      onApplyImage?.(base64);
      message.success(`已应用到${targetLabel || `参考图 ${targetSlot}`}`);
      onClose();
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        message.warning('已取消截图');
      } else {
        message.error('截图失败，请重试');
        console.error('[PoseEditorWeb] 截图失败:', err);
      }
    } finally {
      setIsCapturing(false);
    }
  };

  const slotLabel = targetLabel || (targetSlot === 1 ? '参考图' : `参考图 ${targetSlot}`);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={`姿势参考 — posemy.art`}
      className="pose-editor-modal"
      width="90vw"
      style={{ top: '3vh' }}
      destroyOnHidden
      footer={
        <div className="pose-editor-footer">
          <Typography.Text type="secondary" className="pose-editor-capture-hint">
            编辑器显示后，摆好姿势再截图。在浏览器分享窗口选择当前 ai-draw 标签页，即可自动裁切并应用。
          </Typography.Text>
          <Button
            type="primary"
            icon={<CameraOutlined />}
            loading={isCapturing}
            onClick={handleCapture}
          >
            截图并应用到{slotLabel}
          </Button>
        </div>
      }
    >
      {showInstallGuide ? (
      <section className="pose-editor-install-guide" aria-label="姿势编辑器扩展安装指南">
        <div className="pose-editor-guide-heading">
          <Typography.Text strong>{embeddingStatus === 'disabled' ? '首次使用：安装姿势编辑器扩展' : '姿势编辑器安装说明'}</Typography.Text>
          <Button type="text" size="small" icon={<UpOutlined />} disabled={isCapturing} onClick={() => setGuideOverride(false)}>
            收起说明
          </Button>
        </div>
        <ol>
          <li>点击“安装扩展”，在 Chrome 商店为 Ignore X-Frame headers 点击“添加至 Chrome”并确认安装。</li>
          <li>在 Chrome 中启用扩展，允许在本站和 posemy.art 上运行，再点击“已安装，重新加载”。</li>
        </ol>
        <div className="pose-editor-guide-actions">
          <Button
            href={EXTENSION_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            icon={<DownloadOutlined />}
          >
            安装扩展
          </Button>
          <Button
            icon={<ReloadOutlined />}
            disabled={isCapturing}
            onClick={reloadEditor}
          >
            已安装，重新加载
          </Button>
          <Button
            type="link"
            href={POSE_EDITOR_URL}
            target="_blank"
            rel="noopener noreferrer"
            icon={<ExportOutlined />}
            disabled={isCapturing}
            onClick={onClose}
          >
            直接打开网页
          </Button>
        </div>
        <Typography.Text type="secondary" className="pose-editor-guide-note">
          建议仅在使用姿势工具时启用扩展。无法安装扩展时，可直接打开网页，截图后返回上传或粘贴。
        </Typography.Text>
      </section>
      ) : (
        <div className="pose-editor-toolbar">
          {embeddingStatus === 'checking' && <Typography.Text type="secondary" role="status">正在检查编辑器支持…</Typography.Text>}
          <Button type="text" size="small" icon={<QuestionCircleOutlined />} disabled={isCapturing} onClick={() => setGuideOverride(true)}>
            安装说明
          </Button>
          <Button type="text" size="small" icon={<ReloadOutlined />} disabled={isCapturing} onClick={reloadEditor}>
            重新加载
          </Button>
          <Button type="link" size="small" href={POSE_EDITOR_URL} target="_blank" rel="noopener noreferrer" icon={<ExportOutlined />} disabled={isCapturing} onClick={onClose}>
            直接打开网页
          </Button>
        </div>
      )}
      <iframe
        key={frameVersion}
        ref={iframeRef}
        src={POSE_EDITOR_URL}
        className="pose-editor-frame"
        allow="fullscreen"
        title="posemy.art 姿势参考"
      />
    </Modal>
  );
}
