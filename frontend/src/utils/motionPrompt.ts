import type { MotionPromptSnapshot, MotionReferenceMode, PromptPreset, WorkflowMetadata } from '../types/api';
import type { ChatMessage } from '../types/models';

// Mirrors utils/motion_prompt.py; the pose policy is unchanged so fixed-scene snapshots stay valid.
export const MOTION_PROMPT_POLICY = 'reference-actions-primary-v1';
export const SHOT_MOTION_PROMPT_POLICY = 'reference-shot-v1';
export const FACE_MOTION_PROMPT_POLICY = 'reference-face-v1';
// A motion video replaces the pose images and never shares snapshots with them.
export const VIDEO_MOTION_PROMPT_POLICY = 'reference-video-actions-v1';
export const VIDEO_SHOT_MOTION_PROMPT_POLICY = 'reference-video-shot-v1';
export const VIDEO_FACE_MOTION_PROMPT_POLICY = 'reference-video-face-v1';
const POLICIES: Record<MotionReferenceMode, readonly [images: string, video: string]> = {
  pose: [MOTION_PROMPT_POLICY, VIDEO_MOTION_PROMPT_POLICY],
  shot: [SHOT_MOTION_PROMPT_POLICY, VIDEO_SHOT_MOTION_PROMPT_POLICY],
  face: [FACE_MOTION_PROMPT_POLICY, VIDEO_FACE_MOTION_PROMPT_POLICY],
};

/** Snapshots without a known mode (all historical ones) keep the fixed-scene pose mode. */
export const motionReferenceMode = (value: unknown): MotionReferenceMode =>
  value === 'shot' || value === 'face' ? value : 'pose';

export interface MotionPromptSource {
  reference_image: string;
  motion_reference_images: string[];
  motion_reference_video: string | null;
  description: string;
  motion_reference_mode: MotionReferenceMode;
}

/** Mirror of the backend rule: a workflow may pin its own mode (换脸工作流固定 face); otherwise the preset decides. */
export const referenceModeOf = (workflowMode: unknown, preset?: PromptPreset | null): MotionReferenceMode =>
  motionReferenceMode(workflowMode ?? preset?.motion_reference_mode);

/** The inherent mode of a stored workflow key, resolved from the workflow catalog. */
export const workflowMotionMode = (
  workflows: readonly WorkflowMetadata[] | undefined, workflow?: string,
): MotionReferenceMode | undefined => {
  const mode = workflows?.find(item => item.key === workflow)?.motion_reference_mode;
  return mode === 'shot' || mode === 'face' ? mode : undefined;
};

export function motionPromptSource(
  character: string | null | undefined, poses: readonly string[], description: string, preset?: PromptPreset | null,
  video?: string | null, workflowMode?: MotionReferenceMode,
): MotionPromptSource {
  return {
    reference_image: character ?? '',
    motion_reference_images: video ? [] : [...poses],
    motion_reference_video: video || null,
    description: (preset?.prompt.trim() ?? '') + description.trim(),
    motion_reference_mode: referenceModeOf(workflowMode, preset),
  };
}

export function motionPromptSourceKey(source: MotionPromptSource): string {
  const [imagePolicy, videoPolicy] = POLICIES[motionReferenceMode(source.motion_reference_mode)];
  if (source.motion_reference_video) {
    return JSON.stringify([1, videoPolicy, source.reference_image, source.motion_reference_video, source.description.trim()]);
  }
  return JSON.stringify([1, imagePolicy, source.reference_image, source.motion_reference_images, source.description.trim()]);
}

/** Applying the generated text changes the description, so bind the same analysis to that new draft. */
export async function rebindMotionPrompt(snapshot: MotionPromptSnapshot, source: MotionPromptSource): Promise<MotionPromptSnapshot> {
  const data = new TextEncoder().encode(motionPromptSourceKey(source));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return { ...snapshot, input_hash: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('') };
}

/** A stored snapshot is reusable when its source key matches; the key carries the mode policy, so modes cannot mix. */
export function resolveMotionPrompt(
  stored: MotionPromptSnapshot | null | undefined, history: readonly ChatMessage[], source: MotionPromptSource,
  workflows?: readonly WorkflowMetadata[],
): MotionPromptSnapshot | null {
  if (stored?.version === 1) return stored;
  const key = motionPromptSourceKey(source);
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index], params = message.params;
    if (message.type !== 'user' || params?.motionPrompt?.version !== 1) continue;
    const character = params.referenceImages?.[0] ?? params.referenceImage;
    const historical = motionPromptSource(
      character, params.motionReferenceImages ?? [], message.content, params.promptPreset,
      params.motionReferenceVideo, workflowMotionMode(workflows, params.workflow),
    );
    if (motionPromptSourceKey(historical) === key) {
      return params.motionPrompt;
    }
  }
  return null;
}
