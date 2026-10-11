import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Button, Image, message } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined, CloseOutlined, PlusOutlined, UserOutlined, VideoCameraAddOutlined } from '@ant-design/icons';
import { apiService } from '../api/services';
import type { MotionReferenceMode } from '../types/api';
import { isVideoUrl } from '../utils/media';
import { MAX_MOTION_REFERENCES, getMotionVideoFileError, getMotionVideoOutputSeconds, moveMotionReference } from '../utils/motionReferences';
import './MotionReferenceImages.css';

/** Pose images and one motion video are alternatives; the video option exists only when the workflow declares it. */
export interface MotionVideoOptions {
  value: string | null;
  onChange: (video: string | null) => void;
  workflow: string;
  maxSeconds: number;
}

export interface MotionReferenceImagesHandle {
  uploadVideo: (file: File) => void;
}

// Wording follows the selected preset: pose keeps the original scene, shot replaces the whole person,
// face replaces only the face and hair of the person in the references.
const COPY: Record<MotionReferenceMode, { heading: string; images: string; video: string; imageHint: string; videoHint: string }> = {
  pose: {
    heading: '动作参考', images: '按顺序完成姿势，自动衔接中间动作', video: '只取视频里的肢体动作与节奏，保留原图画面',
    imageHint: '可多选、粘贴或拖入白模姿势图；只参考动作，时间和姿态可能有偏差。', videoHint: '不沿用视频里的人物、背景和运镜',
  },
  shot: {
    heading: '镜头与动作参考', images: '按顺序跟随镜头、构图与动作，自动衔接', video: '跟随视频的镜头、构图、动作与节奏，换成主体',
    imageHint: '可多选、粘贴或拖入参考图；主体只取外观，镜头、构图和动作以参考图为准，时间和姿态可能有偏差。',
    videoHint: '人物整个换成主体，镜头和场景沿用视频',
  },
  face: {
    heading: '换脸参考', images: '按顺序跟随镜头与动作，只换脸和发型', video: '保留视频里人物的服装、动作与镜头，只换脸和发型',
    imageHint: '可多选、粘贴或拖入参考图；只把图中人物的脸和发型换成主体，服装、镜头、构图和动作以参考图为准，效果可能有偏差。',
    videoHint: '只换脸和发型，服装、镜头和场景沿用视频',
  },
};

interface Props {
  images: string[];
  onChange: (images: string[]) => void;
  onCapture?: () => void;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
  /** 所选预设的参考方式：固定镜头动作、参考镜头整个换人或只换脸 */
  mode?: MotionReferenceMode;
  video?: MotionVideoOptions;
}

const MotionReferenceImages = forwardRef<MotionReferenceImagesHandle, Props>(function MotionReferenceImages(
  { images, onChange, onCapture, onUploadingChange, disabled = false, mode = 'pose', video }, ref,
) {
  const input = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const latest = useRef(images);
  const alive = useRef(true);
  const pending = useRef(false);
  const videoUpload = useRef<AbortController | null>(null);
  const [uploading, setUploading] = useState(false);
  const [videoProgress, setVideoProgress] = useState<number | null>(null);
  const [clipSeconds, setClipSeconds] = useState<number | null>(null);
  const motionVideo = video?.value ?? null;
  useEffect(() => { latest.current = images; }, [images]);
  useEffect(() => {
    alive.current = true;
    // Unmounting (e.g. switching sessions) must not attach a late upload to another composer.
    return () => { alive.current = false; videoUpload.current?.abort(); };
  }, []);
  useEffect(() => () => onUploadingChange?.(false), [onUploadingChange]);
  useEffect(() => { setClipSeconds(null); }, [motionVideo]);

  const begin = () => { pending.current = true; setUploading(true); onUploadingChange?.(true); };
  const end = () => {
    pending.current = false;
    if (alive.current) { setUploading(false); setVideoProgress(null); onUploadingChange?.(false); }
  };

  const upload = async (files: File[]) => {
    if (disabled || pending.current || !files.length) return;
    if (motionVideo) { message.warning('已使用动作视频；如需改用动作图，请先移除视频'); return; }
    if (files.length + latest.current.length > MAX_MOTION_REFERENCES) {
      message.warning('最多添加 8 张动作参考图'); return;
    }
    if (files.some(file => !file.type.startsWith('image/') || file.size >= 10 * 1024 * 1024)) {
      message.warning('请选择小于 10MB 的图片'); return;
    }
    begin();
    try {
      const results = await Promise.allSettled(files.map(file => apiService.uploadImage(file)));
      if (!alive.current) return;
      const added = results.flatMap(result => result.status === 'fulfilled' ? [result.value.image] : []);
      const next = [...latest.current, ...added].slice(0, MAX_MOTION_REFERENCES);
      latest.current = next;
      onChange(next);
      if (added.length !== files.length) message.error('部分动作图上传失败，请重新添加');
    } finally {
      end();
    }
  };

  const uploadVideo = async (file: File) => {
    if (!video || disabled || pending.current) return;
    if (latest.current.length) { message.warning('动作参考图和动作视频只能二选一，请先移除动作图'); return; }
    const error = getMotionVideoFileError(file);
    if (error) { message.warning(error); return; }
    begin();
    setVideoProgress(0);
    const controller = new AbortController();
    videoUpload.current = controller;
    try {
      const result = await apiService.uploadMotionVideo(file, video.workflow,
        percent => { if (alive.current) setVideoProgress(percent); }, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      video.onChange(result.url);
      if (result.trimmed) message.info(`视频超过 ${video.maxSeconds} 秒，只保留开头 ${result.duration.toFixed(1)} 秒`);
    } catch (uploadError) {
      if (alive.current && !controller.signal.aborted) {
        message.error(uploadError instanceof Error ? uploadError.message : '动作视频上传失败，请重试');
      }
    } finally {
      if (videoUpload.current === controller) videoUpload.current = null;
      end();
    }
  };

  useImperativeHandle(ref, () => ({ uploadVideo: file => void uploadVideo(file) }));

  const route = (files: File[]) => {
    const clip = files.find(file => file.type.startsWith('video/'));
    if (clip && video) { void uploadVideo(clip); return; }
    if (clip) { message.warning('当前生成方式不支持动作视频'); return; }
    void upload(files);
  };

  const outputSeconds = clipSeconds === null ? null : getMotionVideoOutputSeconds(clipSeconds);
  const copy = COPY[mode] ?? COPY.pose;
  const videoBusy = videoProgress !== null;

  return (
    <section className="motion-references" aria-label="动作参考图片" tabIndex={0}
      onPaste={event => {
        const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/') || file.type.startsWith('video/'));
        if (!files.length) return;
        event.preventDefault(); event.stopPropagation(); route(files);
      }}
      onDragOver={event => { event.preventDefault(); event.stopPropagation(); }}
      onDrop={event => {
        event.preventDefault(); event.stopPropagation();
        if (event.dataTransfer.files.length) { route(Array.from(event.dataTransfer.files)); return; }
        if (disabled || pending.current || motionVideo || images.length >= MAX_MOTION_REFERENCES) return;
        const value = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
        try {
          const url = new URL(value, window.location.origin);
          if (url.origin !== window.location.origin || !url.pathname.startsWith('/uploads/')) return;
          if (isVideoUrl(url.pathname)) { message.warning('请通过「添加动作视频」上传视频文件'); return; }
          onChange([...images, url.pathname]);
        } catch { /* Ignore non-image drag data. */ }
      }}>
      <div className="motion-reference-heading">
        <span>{copy.heading} · {motionVideo ? '视频' : `${images.length}/${MAX_MOTION_REFERENCES}`}</span>
        <span className="motion-reference-hint">{motionVideo ? copy.video : copy.images}</span>
      </div>
      {motionVideo ? (
        <div className="motion-reference-video">
          <video src={motionVideo} muted loop playsInline autoPlay controls preload="metadata" aria-label="动作视频"
            onLoadedMetadata={event => setClipSeconds(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null)} />
          <div className="motion-reference-video-info">
            <span>{clipSeconds === null ? '动作视频' : `视频 ${clipSeconds.toFixed(1)} 秒 → 生成约 ${outputSeconds!.toFixed(1)} 秒`}</span>
            <Button size="small" type="text" icon={<CloseOutlined />} aria-label="移除动作视频"
              disabled={disabled || uploading} onClick={() => video?.onChange(null)}>移除</Button>
          </div>
        </div>
      ) : (
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
      )}
      <div className="motion-reference-upload-actions">
        <input ref={input} type="file" multiple accept="image/*" hidden aria-label="上传动作参考图"
          onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void upload(files); }} />
        {video && <input ref={videoInput} type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm" hidden
          aria-label="上传动作视频"
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadVideo(file); }} />}
        {!motionVideo && <Button size="small" icon={<PlusOutlined />} loading={uploading && !videoBusy}
          disabled={disabled || videoBusy || images.length >= MAX_MOTION_REFERENCES} onClick={() => input.current?.click()}>添加动作图</Button>}
        {!motionVideo && onCapture && <Button size="small" icon={<UserOutlined />} disabled={disabled || uploading || images.length >= MAX_MOTION_REFERENCES}
          onClick={onCapture}>摆姿势并截图</Button>}
        {video && !images.length && <Button size="small" icon={<VideoCameraAddOutlined />} loading={videoBusy}
          disabled={disabled || (uploading && !videoBusy)} onClick={() => videoInput.current?.click()}>
          {videoBusy ? (videoProgress! < 100 ? `上传中 ${videoProgress}%` : '处理中…') : motionVideo ? '更换视频' : '添加动作视频'}
        </Button>}
        <span className="motion-reference-hint">
          {motionVideo
            ? `时长跟随视频，至少 4 秒，最多取开头 ${video?.maxSeconds ?? 0} 秒；${copy.videoHint}，效果可能有偏差。`
            : copy.imageHint}
          {!motionVideo && video && (images.length ? ' 如需改用动作视频，请先移除动作图。' : ` 也可以改用一段动作视频（最多取开头 ${video.maxSeconds} 秒）。`)}
        </span>
      </div>
    </section>
  );
});

export default MotionReferenceImages;
