import type { ChatMessage } from '../types/models.ts';

type GenerationDescription = Pick<ChatMessage, 'content' | 'params'>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]),
  );
  return value;
}

function signature(message: GenerationDescription): string | null {
  const params = message.params;
  if (!params?.workflow) return null;
  return JSON.stringify(canonical({
    prompt: message.content.trim(), workflow: params.workflow,
    strength: params.strength ?? null, count: params.count ?? 1, loraPrompt: params.loraPrompt ?? '',
    width: params.width ?? null, height: params.height ?? null, useOriginalSize: params.useOriginalSize ?? true,
    referenceImages: (params.referenceImages ?? [params.referenceImage, params.referenceImage2, params.referenceImage3]).filter(Boolean),
    referenceImageEnd: params.referenceImageEnd || null,
    workflowOptions: params.workflowOptions ?? {}, promptPreset: params.promptPreset ?? null,
    motionReferenceImages: params.motionReferenceImages ?? [], motionReferenceVideo: params.motionReferenceVideo || null,
  }));
}

/** Only the immediately preceding round can be reused; earlier or foreign rounds never merge. */
export function findRepeatedGeneration(history: readonly ChatMessage[], sessionId: string, next: GenerationDescription): ChatMessage | undefined {
  const user = history.at(-2);
  const assistant = history.at(-1);
  if (!user || !assistant || user.type !== 'user' || assistant.type !== 'assistant'
    || user.session_id !== sessionId || assistant.session_id !== sessionId
    || assistant.id !== `${user.id}-reply`) return;
  const request = signature(next);
  if (!request || request !== signature(user)) return;
  // A server-created motion analysis is an output of the last task. An omitted
  // preview still means automatic analysis; an explicitly edited preview is input.
  if (next.params?.motionPrompt && JSON.stringify(canonical(next.params.motionPrompt)) !== JSON.stringify(canonical(user.params?.motionPrompt))) return;
  return assistant;
}
