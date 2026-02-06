import { Upload, Button, Image, App } from 'antd';
import { InboxOutlined, DeleteOutlined } from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import { apiService } from '../api/services';
import type { UploadProps } from 'antd';

const { Dragger } = Upload;

export default function ImageUploader() {
  const { message } = App.useApp();
  const { referenceImage, setReferenceImage, setError } = useAppStore();

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
        // 压缩图片（降低分辨率和质量，避免 413 错误）
        const { compressImage } = await import('../utils/helpers');
        const compressed = await compressImage(file, 1024, 1024, 0.8);
        const compressedFile = new File([compressed], file.name, { type: 'image/jpeg' });
        
        const res = await apiService.uploadImage(compressedFile);
        setReferenceImage(res.image);
        message.success('上传成功!');
      } catch (err: any) {
        setError(err.message);
        message.error('上传失败: ' + err.message);
      }

      return false; // 阻止默认上传行为
    },
  };

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>参考图片</span>
        {referenceImage && (
          <Button
            danger
            size="small"
            icon={<DeleteOutlined />}
            onClick={() => {
              setReferenceImage(null);
              // 保存配置状态
              setTimeout(() => useAppStore.getState().saveSessionConfig(), 0);
            }}
          >
            删除
          </Button>
        )}
      </div>
      
      {referenceImage ? (
        <div style={{ 
          border: '1px solid var(--border-color)', 
          borderRadius: 8, 
          overflow: 'hidden',
          background: 'var(--bg-secondary)'
        }}>
          <Image
            src={referenceImage}
            alt="参考图片"
            style={{ width: '100%', maxHeight: 200, objectFit: 'contain' }}
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
