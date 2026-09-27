import type { PromptPreset, WorkflowMetadata } from '../types/api';

export const REMOVED_IMAGE_MENTION = '@图片已移除';
const mentionPattern = () => /(?<![A-Za-z0-9_@.])@图片([0-9]+)(?![0-9A-Za-z_])|<image([0-9]+)>/g;

export function supportsImageMentions(metadata: WorkflowMetadata | undefined): boolean {
  return metadata?.supports_multi_image === true && metadata.output_type !== 'video';
}

export interface ImageMentionQuery { start: number; end: number; search: string }

export function findImageMentionQuery(value: string, start: number, end = start): ImageMentionQuery | null {
  if (start !== end || start < 1) return null;
  const trigger = value.lastIndexOf('@', start - 1);
  if (trigger < 0 || (trigger > 0 && /[A-Za-z0-9_@.]/.test(value[trigger - 1]))) return null;
  const search = value.slice(trigger + 1, start);
  if (!/^(?:图(?:片[0-9]*)?|[0-9]*)$/.test(search)) return null;
  return { start: trigger, end: start, search };
}

export function insertImageMention(value: string, query: ImageMentionQuery, index: number) {
  const inserted = `@图片${index} `;
  return {
    value: value.slice(0, query.start) + inserted + value.slice(query.end),
    caret: query.start + inserted.length,
  };
}

/** Compact slots and rewrite all references in one pass, before saving either value. */
export function compactImageReferences(prompt: string, references: readonly (string | null | undefined)[]) {
  const images: string[] = [];
  const positions = references.map(image => image ? images.push(image) : null);
  const nextPrompt = prompt.replace(mentionPattern(), (token: string, mention: string, legacy: string) => {
    const index = Number(mention ?? legacy);
    if (index < 1 || index > positions.length) return token;
    const next = positions[index - 1];
    if (next === null) return REMOVED_IMAGE_MENTION;
    return legacy ? `<image${next}>` : `@图片${next}`;
  });
  return { prompt: nextPrompt, images };
}

export function getImageMentionError(prompt: string, references: readonly (string | null | undefined)[]): string | null {
  if (prompt.includes(REMOVED_IMAGE_MENTION)) return '引用的图片已移除，请重新选择图片或删除该引用。';
  for (const match of prompt.matchAll(mentionPattern())) {
    const index = Number(match[1] ?? match[2]);
    if (index < 1 || index > 3 || !references[index - 1]) return `图片${index}不存在，请先添加参考图或修改引用。`;
  }
  return null;
}

type PresetReferences = Pick<PromptPreset, 'prompt' | 'images' | 'output_type' | 'requires_motion_reference' | 'workflow_ids'>;

export function getWorkflowPresets(presets: PromptPreset[], metadata: WorkflowMetadata | undefined): PromptPreset[] {
  return metadata ? presets.filter(preset => !getPresetWorkflowBlocker(preset, metadata)) : [];
}

/** Presets rely on the reference slots they mention or declare an image role for. */
function getPresetReferenceCount(preset: PresetReferences): number {
  const indices = [...preset.prompt.matchAll(mentionPattern())].map(match => Number(match[1] ?? match[2]));
  const slots = preset.images.map((image, index) => image.slot ?? index + 1);
  return Math.max(0, ...slots.filter((slot): slot is number => slot !== 'end'), ...indices);
}

/** Check output type and reference capabilities before offering a preset. */
export function getPresetWorkflowBlocker(preset: PresetReferences, metadata: WorkflowMetadata | undefined): string | null {
  const outputType = preset.output_type ?? 'image';
  if (outputType !== (metadata?.output_type ?? 'image')) return '此预设不适用于当前生成方式，请重新选择';
  if (preset.workflow_ids && (!metadata || !preset.workflow_ids.includes(metadata.key))) return '此预设不适用于当前生成方式，请重新选择';
  if (preset.requires_motion_reference && !metadata?.supports_motion_reference) return '此预设需要支持动作参考图的生成方式';
  const count = getPresetReferenceCount(preset);
  if (count > 3) return '预设最多支持 3 张参考图';
  if (outputType === 'image') {
    if (count > 0 && !supportsImageMentions(metadata)) return '当前工作流不支持引用参考图';
  } else {
    const capacity = metadata?.supports_multi_image ? 3
      : metadata?.requires_image || metadata?.supports_optional_keyframes ? 1 : 0;
    if (count > capacity) return '当前工作流不支持预设要求的起始参考图';
  }
  if (preset.images.some(image => image.slot === 'end')
      && !metadata?.requires_end_image && !metadata?.supports_optional_keyframes) return '当前工作流不支持结束帧';
  return null;
}

/** Why a request with the preset cannot be sent yet; references may be added after choosing it. */
export function getPresetBlocker(
  preset: PresetReferences,
  metadata: WorkflowMetadata | undefined,
  references: readonly (string | null | undefined)[],
  endReference?: string | null,
  motionReferences: readonly (string | null | undefined)[] = [],
): string | null {
  const blocker = getPresetWorkflowBlocker(preset, metadata);
  if (blocker) return blocker;
  for (let index = 1; index <= getPresetReferenceCount(preset); index++) {
    // Motion presets name their subject image, e.g. 原始画面 or 主体图.
    if (!references[index - 1]) return preset.output_type === 'video' && index === 1
      ? (preset.requires_motion_reference ? `请先添加${preset.images[0]?.label || '原始画面'}` : '请先添加开始帧') : `请先添加参考图 ${index}`;
  }
  if (preset.images.some(image => image.slot === 'end') && !endReference) return '请先添加结束帧';
  if (preset.requires_motion_reference && !motionReferences.some(image => image?.trim())) return '请先添加动作参考图';
  return null;
}
