import { Upload, Button, Image, message } from 'antd';
import { InboxOutlined, DeleteOutlined } from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import { apiService } from '../api/services';
import type { UploadProps } from 'antd';

const { Dragger } = Upload;

export default function ImageUploader() {
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

      const isLt10M = file.size / 1024 / 1024 < 10;
      if (!isLt10M) {
        message.error('图片大小不能超过 10MB!');
        return false;
      }

      try {
        const res = await apiService.uploadImage(file);
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
            onClick={() => setReferenceImage(null)}
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
