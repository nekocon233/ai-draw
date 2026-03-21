import { useState, lazy, Suspense } from 'react';
import { Upload, Button, Image, message } from 'antd';
import { InboxOutlined, DeleteOutlined, UserOutlined } from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import { apiService } from '../api/services';
import type { UploadProps } from 'antd';

const { Dragger } = Upload;

// 懒加载姿势参考编辑器，避免增大初始包体积
const PoseEditorWeb = lazy(() => import('./PoseEditorWeb'));

interface ImageSlotProps {
  label: string;
  image: string | null;
  setImage: (img: string | null) => void;
  onDelete?: () => void;
  onPoseEdit?: () => void;
}

function ImageSlot({ label, image, setImage, onDelete, onPoseEdit }: ImageSlotProps) {
  const { setError } = useAppStore();

  const uploadProps: UploadProps = {
    name: 'file',
    multiple: false,
    accept: 'image/*',
    showUploadList: false,
    beforeUpload: async (file) => {
      const isImage = file.type.startsWith('image/');
      if (!isImage) {
        message.error('只能上传图片文件!');
        return false;
      }

      try {
        const { compressImage } = await import('../utils/helpers');
        const compressed = await compressImage(file, 1024, 1024, 0.8);
        const compressedFile = new File([compressed], file.name, { type: 'image/jpeg' });

        const res = await apiService.uploadImage(compressedFile);
        setImage(res.image);
        message.success('上传成功!');
      } catch (err: any) {
        setError(err.message);
        message.error('上传失败: ' + err.message);
      }

      return false;
    },
  };

  return (
    <div>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        {image && (
          <Button
            danger
            size="small"
            icon={<DeleteOutlined />}
            onClick={() => {
              if (onDelete) {
                onDelete();
              } else {
                setImage(null);
              }
              setTimeout(() => useAppStore.getState().saveSessionConfig(), 0);
            }}
          >
            删除
          </Button>
        )}
      </div>

      {image ? (
        <div style={{
          border: '1px solid var(--border-color)',
          borderRadius: 8,
          overflow: 'hidden',
          background: 'var(--bg-secondary)'
        }}>
          <Image
            src={image}
            alt={label}
            style={{ width: '100%', maxHeight: 180, objectFit: 'contain' }}
            preview={{ mask: '预览' }}
          />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Dragger {...uploadProps} style={{ background: 'var(--bg-secondary)' }}>
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽图片</p>
            <p className="ant-upload-hint" style={{ fontSize: 12 }}>
              支持 JPG/PNG, 大小不超过 10MB
            </p>
          </Dragger>
          {onPoseEdit && (
            <Button
              block
              size="small"
              icon={<UserOutlined />}
              onClick={onPoseEdit}
              style={{ borderStyle: 'dashed', color: 'var(--text-secondary)' }}
            >
              🎭 姿势参考（posemy.art）
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default function ImageUploader() {
  const {
    referenceImage, setReferenceImage,
    referenceImage2, setReferenceImage2,
    referenceImage3, setReferenceImage3,
  } = useAppStore();

  const [poseEditorOpen, setPoseEditorOpen] = useState(false);
  const [poseTargetSlot, setPoseTargetSlot] = useState<1 | 2 | 3>(1);

  // 删除时向前顶替：删第 1 张 → 2→1, 3→2；删第 2 张 → 3→2；删第 3 张 → 直接清空
  const handleDelete1 = () => {
    setReferenceImage(referenceImage2);
    setReferenceImage2(referenceImage3);
    setReferenceImage3(null);
  };
  const handleDelete2 = () => {
    setReferenceImage2(referenceImage3);
    setReferenceImage3(null);
  };
  const handleDelete3 = () => {
    setReferenceImage3(null);
  };

  const openPoseEditor = (slot: 1 | 2 | 3) => {
    setPoseTargetSlot(slot);
    setPoseEditorOpen(true);
  };

  const handlePoseApply = (base64: string) => {
    if (poseTargetSlot === 1) { setReferenceImage(base64); }
    else if (poseTargetSlot === 2) { setReferenceImage2(base64); }
    else { setReferenceImage3(base64); }
    setTimeout(() => useAppStore.getState().saveSessionConfig(), 0);
  };

  const slots = [
    { label: '参考图片 1', image: referenceImage, setImage: setReferenceImage, onDelete: handleDelete1, onPoseEdit: () => openPoseEditor(1) },
    { label: '参考图片 2（可选）', image: referenceImage2, setImage: setReferenceImage2, onDelete: handleDelete2, onPoseEdit: () => openPoseEditor(2) },
    { label: '参考图片 3（可选）', image: referenceImage3, setImage: setReferenceImage3, onDelete: handleDelete3, onPoseEdit: () => openPoseEditor(3) },
  ];

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {slots.map((slot) => (
          <ImageSlot key={slot.label} {...slot} />
        ))}
      </div>

      {/* 懒加载姿势参考编辑器 */}
      <Suspense fallback={null}>
        {poseEditorOpen && (
          <PoseEditorWeb
            open={poseEditorOpen}
            onClose={() => setPoseEditorOpen(false)}
            targetSlot={poseTargetSlot}
            onApplyImage={handlePoseApply}
          />
        )}
      </Suspense>
    </>
  );
}

