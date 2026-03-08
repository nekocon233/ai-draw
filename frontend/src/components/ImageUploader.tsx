import { Upload, Button, Image, message } from 'antd';
import { InboxOutlined, DeleteOutlined } from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import { apiService } from '../api/services';
import type { UploadProps } from 'antd';

const { Dragger } = Upload;

interface ImageSlotProps {
  label: string;
  image: string | null;
  setImage: (img: string | null) => void;
}

function ImageSlot({ label, image, setImage }: ImageSlotProps) {
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
              setImage(null);
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
        <Dragger {...uploadProps} style={{ background: 'var(--bg-secondary)' }}>
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">点击或拖拽图片</p>
          <p className="ant-upload-hint" style={{ fontSize: 12 }}>
            支持 JPG/PNG, 大小不超过 10MB
          </p>
        </Dragger>
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

  const slots = [
    { label: '参考图片 1', image: referenceImage, setImage: setReferenceImage },
    { label: '参考图片 2（可选）', image: referenceImage2, setImage: setReferenceImage2 },
    { label: '参考图片 3（可选）', image: referenceImage3, setImage: setReferenceImage3 },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {slots.map((slot) => (
        <ImageSlot key={slot.label} {...slot} />
      ))}
    </div>
  );
}

