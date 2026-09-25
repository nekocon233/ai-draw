import type { WorkflowMetadata, WorkflowParameterValue } from '../types/api';

export function resolveAvailableWorkflow(
  requested: string | null | undefined,
  workflows: WorkflowMetadata[],
  fallback = 'qwen_image_21_t2i',
): string {
  // Metadata can arrive after the saved session; validate again when it loads.
  if (workflows.length === 0) return requested || fallback;
  return workflows.find(workflow => workflow.key === requested)?.key
    ?? workflows.find(workflow => workflow.key === fallback)?.key
    ?? workflows[0].key;
}

/** A retired workflow's adapters must never leak into its replacement. */
export function restoreWorkflowSelection(
  requested: string | null | undefined,
  loraPrompt: string | null | undefined,
  workflows: WorkflowMetadata[],
  fallback = 'qwen_image_21_t2i',
): { currentWorkflow: string; loraPrompt: string } {
  const currentWorkflow = resolveAvailableWorkflow(requested, workflows, fallback);
  return { currentWorkflow, loraPrompt: currentWorkflow === requested ? loraPrompt ?? '' : '' };
}

export function getGenerationCount(metadata: WorkflowMetadata | undefined, requested: number): number {
  const countParameter = metadata?.parameters.find(parameter => parameter.name === 'count');
  const maximum = metadata?.max_count
    ?? (metadata?.output_type === 'video' ? 1 : countParameter?.max ?? 1);
  return Math.max(1, Math.min(Number.isFinite(requested) ? Math.floor(requested) : 1, maximum));
}

export function getWorkflowOptions(
  metadata: WorkflowMetadata | undefined,
  values: Record<string, WorkflowParameterValue>,
): Record<string, WorkflowParameterValue> {
  if (!metadata) return {};
  return Object.fromEntries(
    metadata.parameters
      .filter(parameter => parameter.type === 'select')
      .map(parameter => {
        const current = values[parameter.name];
        const valid = current !== undefined
          && (!parameter.options || parameter.options.includes(String(current)));
        return [parameter.name, valid ? current : parameter.default];
      }),
  );
}

/** Several execution workflows can share one user-facing generation method. */
export function getWorkflowMethodKey(workflow: string, workflows: WorkflowMetadata[]): string {
  return workflows.find(item => item.key === workflow)?.method_group || workflow;
}

export function getWorkflowMethods(workflows: WorkflowMetadata[], selected?: string): WorkflowMetadata[] {
  const methods = new Map<string, WorkflowMetadata>();
  for (const workflow of workflows) {
    const key = workflow.method_group || workflow.key;
    if (!methods.has(key) || workflow.key === selected) methods.set(key, workflow);
  }
  return [...methods.values()];
}

export function resolveInputWorkflow(
  requested: string | null | undefined,
  workflows: WorkflowMetadata[],
  referenceImage?: string | null | readonly (string | null | undefined)[],
): string {
  const workflow = resolveAvailableWorkflow(requested, workflows);
  const metadata = workflows.find(item => item.key === workflow);
  const hasImage = Array.isArray(referenceImage) ? referenceImage.some(Boolean) : Boolean(referenceImage);
  const target = hasImage ? metadata?.image_workflow : metadata?.text_workflow;
  return target && workflows.some(item => item.key === target) ? target : workflow;
}

export function compactReferenceImages(images: readonly (string | null | undefined)[]): string[] {
  return images.filter((image): image is string => Boolean(image));
}

export interface ParkedReferences {
  images: string[];
  endImage: string | null;
}

export const NO_PARKED_REFERENCES: ParkedReferences = { images: [], endImage: null };

/** How many references a method shows in the composer; anything past that waits in the parking lot. */
export function getReferenceImageCapacity(metadata: WorkflowMetadata | undefined): number {
  if (!metadata) return 0;
  if (metadata.supports_multi_image) return 3;
  if (metadata.requires_image || metadata.image_workflow || metadata.supports_optional_keyframes) return 1;
  return 0;
}

export function acceptsEndReferenceImage(metadata: WorkflowMetadata | undefined): boolean {
  return metadata?.requires_end_image === true || metadata?.supports_optional_keyframes === true;
}

export interface CarriedReferences {
  images: [string | null, string | null, string | null];
  endImage: string | null;
  parked: ParkedReferences;
}

/** Switching methods leaves the composer alone: it keeps what fits and parks the rest for the way back. */
export function carryReferenceImages(
  metadata: WorkflowMetadata | undefined,
  images: readonly (string | null | undefined)[],
  endImage: string | null | undefined,
  parked: ParkedReferences = NO_PARKED_REFERENCES,
): CarriedReferences {
  const available: string[] = [];
  for (const image of [...images, ...parked.images]) {
    if (image && !available.includes(image)) available.push(image);
  }
  const kept = available.slice(0, getReferenceImageCapacity(metadata));
  const end = endImage || parked.endImage || null;
  const keepsEnd = acceptsEndReferenceImage(metadata);
  return {
    images: [kept[0] ?? null, kept[1] ?? null, kept[2] ?? null],
    endImage: keepsEnd ? end : null,
    parked: { images: available.slice(kept.length), endImage: keepsEnd ? null : end },
  };
}

/** Snapshot the effective settings for both the first submission and history retries. */
export function getImageGenerationSettings(
  metadata: WorkflowMetadata | undefined,
  settings: { width?: number | null; height?: number | null; useOriginalSize?: boolean | null },
  hasReferenceImage: boolean,
): { width?: number; height?: number; useOriginalSize: boolean } {
  const dimension = (name: 'width' | 'height') => {
    const parameter = metadata?.parameters.find(item => item.name === name);
    return parameter ? settings[name] ?? Number(parameter.default) : undefined;
  };
  return {
    width: dimension('width'),
    height: dimension('height'),
    useOriginalSize: Boolean(metadata?.supports_original_size && hasReferenceImage && (settings.useOriginalSize ?? true)),
  };
}

export function resolveInputLora(
  value: string | null | undefined,
  workflow: string,
  workflows: WorkflowMetadata[],
): string {
  const metadata = workflows.find(item => item.key === workflow);
  if (value !== null && value !== undefined) return value;
  return String(metadata?.parameters.find(item => item.name === 'lora_prompt')?.default ?? '');
}

/** Migrate the old image categories without letting an initial default overwrite a saved choice. */
export function rememberWorkflowMethod(
  remembered: Record<string, string>,
  workflows: WorkflowMetadata[],
  selected?: string,
): Record<string, string> {
  const next = { ...remembered };
  const imageMethods = workflows.filter(item => item.category === '生图');
  const validImage = (key: string | undefined) => imageMethods.some(item => item.key === key);
  if (imageMethods.length && !validImage(next['生图'])) {
    const previous = ['草稿成图', '图生图', '文生图'].map(category => remembered[category]).find(validImage);
    next['生图'] = previous ?? resolveAvailableWorkflow(undefined, imageMethods);
  }
  const current = workflows.find(item => item.key === selected);
  if (current?.category && getWorkflowMethods(workflows.filter(item => item.category === current.category)).length > 1) {
    next[current.category] = current.key;
  }
  return next;
}
