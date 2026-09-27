import type { MotionPromptSnapshot, MotionReferenceMode, PromptPreset } from '../types/api';
import type { ChatMessage } from '../types/models';

// Mirrors utils/motion_prompt.py; the pose policy is unchanged so fixed-scene snapshots stay valid.
export const MOTION_PROMPT_POLICY = 'reference-actions-primary-v1';
export const SHOT_MOTION_PROMPT_POLICY = 'reference-shot-v1';

export interface MotionPromptSource {
  reference_image: string;
  motion_reference_images: string[];
  description: string;
  motion_reference_mode: MotionReferenceMode;
}

export function motionPromptSource(character: string | null | undefined, poses: readonly string[], description: string, preset?: PromptPreset | null): MotionPromptSource {
  return {
    reference_image: character ?? '',
    motion_reference_images: [...poses],
    description: (preset?.prompt.trim() ?? '') + description.trim(),
    motion_reference_mode: preset?.motion_reference_mode === 'shot' ? 'shot' : 'pose',
  };
}

export function motionPromptSourceKey(source: MotionPromptSource): string {
  const policy = source.motion_reference_mode === 'shot' ? SHOT_MOTION_PROMPT_POLICY : MOTION_PROMPT_POLICY;
  return JSON.stringify([1, policy, source.reference_image, source.motion_reference_images, source.description.trim()]);
}

/** Applying the generated text changes the description, so bind the same analysis to that new draft. */
export async function rebindMotionPrompt(snapshot: MotionPromptSnapshot, source: MotionPromptSource): Promise<MotionPromptSnapshot> {
  const data = new TextEncoder().encode(motionPromptSourceKey(source));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return { ...snapshot, input_hash: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('') };
}

export function resolveMotionPrompt(stored: MotionPromptSnapshot | null | undefined, history: readonly ChatMessage[], source: MotionPromptSource): MotionPromptSnapshot | null {
  if (stored?.version === 1) return stored;
  const key = motionPromptSourceKey(source);
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index], params = message.params;
    if (message.type !== 'user' || params?.workflow !== 'minimax_h3_ref' || params.motionPrompt?.version !== 1) continue;
    if (motionPromptSourceKey(motionPromptSource(params.referenceImage, params.motionReferenceImages ?? [], message.content, params.promptPreset)) === key) {
      return params.motionPrompt;
    }
  }
  return null;
}
