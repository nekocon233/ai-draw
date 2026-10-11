export const MAX_MOTION_REFERENCES = 8;
export const MAX_MOTION_VIDEO_BYTES = 100 * 1024 * 1024;
/** Mirrors the backend's stored form; anything else is not a usable motion video. */
export const MOTION_VIDEO_URL = /^\/uploads\/reference\/\d+\/[0-9a-f]{32}\.mp4$/;
const MOTION_VIDEO_FPS = 24;

export const isMotionVideoUrl = (value: unknown): value is string => typeof value === 'string' && MOTION_VIDEO_URL.test(value);

export function getMotionReferenceError(character: string | null | undefined, images: readonly string[], video?: string | null): string | null {
  if (!character) return '请上传角色外观图';
  if (video) return images.length ? '动作参考图和动作视频只能二选一' : null;
  if (!images.length) return '请添加至少一张动作参考图或一段动作视频';
  if (images.length > MAX_MOTION_REFERENCES || images.some(image => !image.trim())) return '请提供 1 到 8 张有效动作图';
  return null;
}

export function getMotionVideoFileError(file: Pick<File, 'type' | 'name' | 'size'>): string | null {
  if (!file.type.startsWith('video/') && !/\.(mp4|m4v|mov|webm)$/i.test(file.name)) return '请选择 MP4、MOV 或 WebM 视频';
  if (file.size > MAX_MOTION_VIDEO_BYTES) return '动作视频不能超过 100MB';
  return null;
}

/** Mirrors get_minimax_h3_video_frame_count: the clip sets the length, at least four seconds, on the 17k+5 grid. */
export function getMotionVideoFrameCount(seconds: number): number {
  let frames = Math.max(5, Math.round(Math.min(15, Math.max(4, seconds)) * MOTION_VIDEO_FPS));
  while (frames % 17 !== 5) frames += 1;
  return frames;
}

export const getMotionVideoOutputSeconds = (seconds: number) => getMotionVideoFrameCount(seconds) / MOTION_VIDEO_FPS;

export function moveMotionReference(images: readonly string[], from: number, to: number): string[] {
  const result = [...images];
  if (from < 0 || to < 0 || from >= result.length || to >= result.length) return result;
  const [image] = result.splice(from, 1);
  result.splice(to, 0, image);
  return result;
}
