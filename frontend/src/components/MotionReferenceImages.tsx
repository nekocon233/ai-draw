import { useEffect, useRef, useState } from 'react';
import { Button, Image, message } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined, CloseOutlined, PlusOutlined, UserOutlined } from '@ant-design/icons';
import { apiService } from '../api/services';
import { MAX_MOTION_REFERENCES, moveMotionReference } from '../utils/motionReferences';
import './MotionReferenceImages.css';

interface Props {
  images: string[];
  onChange: (images: string[]) => void;
  onCapture?: () => void;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
}

export default function MotionReferenceImages({ images, onChange, onCapture, onUploadingChange, disabled = false }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(images);
  const alive = useRef(true);
  const pending = useRef(false);
  const [uploading, setUploading] = useState(false);
  useEffect(() => { latest.current = images; }, [images]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => () => onUploadingChange?.(false), [onUploadingChange]);

  const upload = async (files: File[]) => {
    if (disabled || pending.current || !files.length) return;
    if (files.length + latest.current.length > MAX_MOTION_REFERENCES) {
      message.warning('最多添加 8 张动作参考图'); return;
    }
    if (files.some(file => !file.type.startsWith('image/') || file.size >= 10 * 1024 * 1024)) {
      message.warning('请选择小于 10MB 的图片'); return;
    }
    pending.current = true;
    setUploading(true);
    onUploadingChange?.(true);
    try {
      const results = await Promise.allSettled(files.map(file => apiService.uploadImage(file)));
      if (!alive.current) return;
      const added = results.flatMap(result => result.status === 'fulfilled' ? [result.value.image] : []);
      const next = [...latest.current, ...added].slice(0, MAX_MOTION_REFERENCES);
      latest.current = next;
      onChange(next);
      if (added.length !== files.length) message.error('部分动作图上传失败，请重新添加');
    } finally {
      pending.current = false;
      if (alive.current) { setUploading(false); onUploadingChange?.(false); }
    }
  };

  return (
    <section className="motion-references" aria-label="动作参考图片" tabIndex={0}
      onPaste={event => {
        const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
        if (!files.length) return;
        event.preventDefault(); event.stopPropagation(); void upload(files);
      }}
      onDragOver={event => { event.preventDefault(); event.stopPropagation(); }}
      onDrop={event => {
        event.preventDefault(); event.stopPropagation();
        if (event.dataTransfer.files.length) { void upload(Array.from(event.dataTransfer.files)); return; }
        if (disabled || pending.current || images.length >= MAX_MOTION_REFERENCES) return;
        const value = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
        try {
          const url = new URL(value, window.location.origin);
          if (url.origin === window.location.origin && url.pathname.startsWith('/uploads/')) onChange([...images, url.pathname]);
        } catch { /* Ignore non-image drag data. */ }
      }}>
      <div className="motion-reference-heading">
        <span>动作参考 · {images.length}/{MAX_MOTION_REFERENCES}</span>
        <span className="motion-reference-hint">按顺序完成姿势，自动衔接中间动作</span>
      </div>
      <div className="motion-reference-list">
        {images.map((image, index) => (
          <div className="motion-reference-item" key={`${index}-${image.slice(-80)}`}>
            <Image src={image} alt={`动作 ${index + 1}`} width={72} height={72} style={{ objectFit: 'contain' }} />
            <span>动作 {index + 1}</span>
            <div className="motion-reference-actions">
              <Button size="small" type="text" icon={<ArrowLeftOutlined />} aria-label={`前移动作 ${index + 1}`}
                disabled={disabled || uploading || index === 0} onClick={() => onChange(moveMotionReference(images, index, index - 1))} />
              <Button size="small" type="text" icon={<ArrowRightOutlined />} aria-label={`后移动作 ${index + 1}`}
                disabled={disabled || uploading || index === images.length - 1} onClick={() => onChange(moveMotionReference(images, index, index + 1))} />
              <Button size="small" type="text" icon={<CloseOutlined />} aria-label={`移除动作 ${index + 1}`}
                disabled={disabled || uploading} onClick={() => onChange(images.filter((_, position) => position !== index))} />
            </div>
          </div>
        ))}
      </div>
      <div className="motion-reference-upload-actions">
        <input ref={input} type="file" multiple accept="image/*" hidden aria-label="上传动作参考图"
          onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void upload(files); }} />
        <Button size="small" icon={<PlusOutlined />} loading={uploading} disabled={disabled || images.length >= MAX_MOTION_REFERENCES}
          onClick={() => input.current?.click()}>添加动作图</Button>
        {onCapture && <Button size="small" icon={<UserOutlined />} disabled={disabled || uploading || images.length >= MAX_MOTION_REFERENCES}
          onClick={onCapture}>摆姿势并截图</Button>}
        <span className="motion-reference-hint">可多选、粘贴或拖入白模姿势图；只参考动作，时间和姿态可能有偏差。</span>
      </div>
    </section>
  );
}
