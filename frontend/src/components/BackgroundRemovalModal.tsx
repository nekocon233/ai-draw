/**
 * 单图「移除背景」弹窗
 *
 * 与抽帧编辑（FrameExtractionModal）共用 useBackgroundOptions + BackgroundOptionsFields，
 * 调 /media/remove-background，完成后把透明 PNG 经 onRemoved 回传给调用方追加到结果区。
 */
import { useEffect, useState } from 'react';
import { Button, Modal, message } from 'antd';
import { ScissorOutlined } from '@ant-design/icons';
import { apiService } from '../api/services';
import { useBackgroundOptions } from '../hooks/useBackgroundOptions';
import BackgroundOptionsFields from './BackgroundOptionsFields';

interface BackgroundRemovalModalProps {
  open: boolean;
  imageUrl: string | null;
  onClose: () => void;
  onRemoved?: (url: string) => void;
}

export default function BackgroundRemovalModal({
  open,
  imageUrl,
  onClose,
  onRemoved,
}: BackgroundRemovalModalProps) {
  const bg = useBackgroundOptions();
  const { reset: resetBg } = bg;
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (open) {
      resetBg();
    }
  }, [open, resetBg]);

  const handleRemove = async () => {
    if (!imageUrl) return;
    setRemoving(true);
    try {
      const res = await apiService.removeBackground({
        image_url: imageUrl,
        ...bg.toRequest(),
      });
      onRemoved?.(res.image_url);
      message.success('已移除背景，透明图已追加到结果区');
      onClose();
    } catch (err: any) {
      message.error(err?.message || '移除背景失败');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Modal
      title="移除背景"
      open={open}
      onCancel={onClose}
      width={380}
      className="frame-editor-modal"
      destroyOnHidden
      footer={[
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
        <Button
          key="remove"
          type="primary"
          icon={<ScissorOutlined />}
          loading={removing}
          disabled={!imageUrl}
          onClick={handleRemove}
        >
          移除背景
        </Button>,
      ]}
    >
      <BackgroundOptionsFields opts={bg} title="模型" inline />
    </Modal>
  );
}
