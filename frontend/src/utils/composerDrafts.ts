import type { MotionPromptSnapshot, WorkflowMetadata } from '../types/api';
import type { ParkedReferences } from './workflowOptions';

/** 生图与生视频各用一套输入栏；同一类里切换生成方式仍沿用原有的带图和暂存逻辑。 */
export type InputGroup = 'image' | 'video';

export interface ComposerDraft {
  prompt: string;
  referenceImage: string | null;
  referenceImage2: string | null;
  referenceImage3: string | null;
  referenceImageEnd: string | null;
  motionReferenceImages: string[];
  motionPrompt: MotionPromptSnapshot | null;
  parkedReferences: ParkedReferences;
}

export type ComposerDrafts = Partial<Record<InputGroup, ComposerDraft>>;

export interface ApiInputDraft {
  prompt: string;
  reference_image: string | null;
  reference_image_2: string | null;
  reference_image_3: string | null;
  reference_image_end: string | null;
  motion_reference_images: string[];
  motion_prompt: MotionPromptSnapshot | null;
  parked_images: string[];
  parked_end_image: string | null;
}

export type ApiInputDrafts = Partial<Record<InputGroup, ApiInputDraft>>;

export const EMPTY_COMPOSER_DRAFT: ComposerDraft = {
  prompt: '',
  referenceImage: null,
  referenceImage2: null,
  referenceImage3: null,
  referenceImageEnd: null,
  motionReferenceImages: [],
  motionPrompt: null,
  parkedReferences: { images: [], endImage: null },
};

export function inputGroupOf(metadata: Pick<WorkflowMetadata, 'output_type'> | undefined): InputGroup {
  return metadata?.output_type === 'video' ? 'video' : 'image';
}

export function captureComposer(source: ComposerDraft): ComposerDraft {
  return {
    prompt: source.prompt,
    referenceImage: source.referenceImage,
    referenceImage2: source.referenceImage2,
    referenceImage3: source.referenceImage3,
    referenceImageEnd: source.referenceImageEnd,
    motionReferenceImages: [...source.motionReferenceImages],
    motionPrompt: source.motionPrompt,
    parkedReferences: { images: [...source.parkedReferences.images], endImage: source.parkedReferences.endImage },
  };
}

/** A cross-type switch stashes the live composer and brings back the target type's last input. */
export function switchComposer(live: ComposerDraft, drafts: ComposerDrafts, from: InputGroup, to: InputGroup) {
  if (from === to) return { composer: live, drafts };
  const next: ComposerDrafts = { ...drafts, [from]: captureComposer(live) };
  delete next[to];
  const stored = drafts[to];
  return { composer: stored ? captureComposer(stored) : EMPTY_COMPOSER_DRAFT, drafts: next };
}

export function toApiInputDraft(draft: ComposerDraft): ApiInputDraft {
  return {
    prompt: draft.prompt,
    reference_image: draft.referenceImage,
    reference_image_2: draft.referenceImage2,
    reference_image_3: draft.referenceImage3,
    reference_image_end: draft.referenceImageEnd,
    motion_reference_images: [...draft.motionReferenceImages],
    // 与当前输入的保存规则一致：清空的看图分析不保存
    motion_prompt: draft.motionPrompt?.prompt.trim() ? draft.motionPrompt : null,
    parked_images: [...draft.parkedReferences.images],
    parked_end_image: draft.parkedReferences.endImage,
  };
}

/** The live group is mirrored too, so images parked by the current method stay referenced on the server. */
export function toApiInputDrafts(drafts: ComposerDrafts, activeGroup: InputGroup, live: ComposerDraft): ApiInputDrafts {
  const result: ApiInputDrafts = {};
  for (const group of ['image', 'video'] as const) {
    const draft = group === activeGroup ? live : drafts[group];
    if (draft) result[group] = toApiInputDraft(draft);
  }
  return result;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const image = (value: unknown) => (typeof value === 'string' && value ? value : null);
const images = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item) : []);
const motionPrompt = (value: unknown): MotionPromptSnapshot | null => {
  const snapshot = value as Partial<MotionPromptSnapshot> | null;
  return snapshot?.version === 1 && typeof snapshot.input_hash === 'string'
    && typeof snapshot.prompt === 'string' && snapshot.prompt.trim()
    ? { version: 1, input_hash: snapshot.input_hash, prompt: snapshot.prompt } : null;
};

export function fromApiInputDrafts(value: unknown): ComposerDrafts {
  const drafts: ComposerDrafts = {};
  if (!value || typeof value !== 'object') return drafts;
  for (const group of ['image', 'video'] as const) {
    const raw = (value as Record<string, unknown>)[group];
    if (!raw || typeof raw !== 'object') continue;
    const draft = raw as Record<string, unknown>;
    drafts[group] = {
      prompt: text(draft.prompt),
      referenceImage: image(draft.reference_image),
      referenceImage2: image(draft.reference_image_2),
      referenceImage3: image(draft.reference_image_3),
      referenceImageEnd: image(draft.reference_image_end),
      motionReferenceImages: images(draft.motion_reference_images),
      motionPrompt: motionPrompt(draft.motion_prompt),
      parkedReferences: { images: images(draft.parked_images), endImage: image(draft.parked_end_image) },
    };
  }
  return drafts;
}
