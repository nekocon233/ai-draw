export const MAX_MOTION_REFERENCES = 8;

export function getMotionReferenceError(character: string | null | undefined, images: readonly string[]): string | null {
  if (!character) return '请上传角色外观图';
  if (!images.length) return '请添加至少一张动作参考图';
  if (images.length > MAX_MOTION_REFERENCES || images.some(image => !image.trim())) return '请提供 1 到 8 张有效动作图';
  return null;
}

export function moveMotionReference(images: readonly string[], from: number, to: number): string[] {
  const result = [...images];
  if (from < 0 || to < 0 || from >= result.length || to >= result.length) return result;
  const [image] = result.splice(from, 1);
  result.splice(to, 0, image);
  return result;
}
