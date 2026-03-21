import { useRef, useState } from 'react';
import { Modal, Button, Typography, message } from 'antd';
import { CameraOutlined } from '@ant-design/icons';

interface PoseEditorWebProps {
  open: boolean;
  onClose: () => void;
  targetSlot?: 1 | 2 | 3;
  onApplyImage?: (base64: string) => void;
}

export default function PoseEditorWeb({ open, onClose, targetSlot = 1, onApplyImage }: PoseEditorWebProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isCapturing, setIsCapturing] = useState(false);

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
      message.success(`已应用到参考图 ${targetSlot}`);
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

  const slotLabel = targetSlot === 1 ? '参考图' : `参考图 ${targetSlot}`;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={`姿势参考 — posemy.art`}
      width="90vw"
      style={{ top: '3vh' }}
      styles={{ body: { padding: 0, height: '82vh', overflow: 'hidden' } }}
      destroyOnHidden
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            摆好姿势后点击右侧按钮截图，浏览器会弹出分享对话框，选择「当前标签页」即可自动裁切并应用
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
      <iframe
        ref={iframeRef}
        src="https://posemy.art/app/?lang=zhHans"
        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
        allow="fullscreen"
        title="posemy.art 姿势参考"
      />
    </Modal>
  );
}
