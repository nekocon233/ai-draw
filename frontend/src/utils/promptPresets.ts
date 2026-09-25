import type { PromptPreset, PromptPresetChoices, WorkflowMetadata } from '../types/api';
import { getPresetWorkflowBlocker, getWorkflowPresets } from './imageMentions.ts';

/** Seed old saved selections without replacing their wording with the latest catalog. */
export function restorePromptPresetChoices(workflow: string, preset: PromptPreset | null | undefined, choices?: PromptPresetChoices | null): PromptPresetChoices {
  if (preset && !Object.prototype.hasOwnProperty.call(choices ?? {}, workflow)) return { ...choices, [workflow]: preset };
  return choices ?? {};
}

// Text/edit graphs can be two executions of the same visible generation method.
function presetChoiceKeys(metadata: WorkflowMetadata): string[] {
  return [...new Set([metadata.key, metadata.text_workflow, metadata.image_workflow]
    .filter((key): key is string => Boolean(key)))];
}

/** A manual choice applies to both executions when adding/removing a reference switches them. */
export function rememberWorkflowPromptPreset(
  metadata: WorkflowMetadata, preset: PromptPreset | null, choices: PromptPresetChoices,
): PromptPresetChoices {
  return { ...choices, ...Object.fromEntries(presetChoiceKeys(metadata).map(key => [key, preset])) };
}

/** Missing means first use; an explicit null must survive catalog refreshes and mode changes. */
export function resolveWorkflowPromptPreset(
  metadata: WorkflowMetadata | undefined,
  presets: readonly PromptPreset[],
  choices: PromptPresetChoices,
  carriedPreset: PromptPreset | null = null,
): { promptPreset: PromptPreset | null; promptPresetChoices: PromptPresetChoices } {
  if (!metadata) return { promptPreset: carriedPreset, promptPresetChoices: choices };
  const savedKey = presetChoiceKeys(metadata).find(key => Object.prototype.hasOwnProperty.call(choices, key));
  const candidate = savedKey ? choices[savedKey] : carriedPreset;
  if (savedKey && candidate === null) return { promptPreset: null, promptPresetChoices: choices };
  const defaultPreset = getWorkflowPresets([...presets], metadata).find(preset => preset.id === metadata.default_prompt_preset_id);
  const promptPreset = candidate && !getPresetWorkflowBlocker(candidate, metadata) ? candidate : defaultPreset ?? null;
  // Do not record an opt-out merely because the catalog has not arrived yet.
  const promptPresetChoices = promptPreset && choices[metadata.key] !== promptPreset
    ? { ...choices, [metadata.key]: promptPreset } : choices;
  return { promptPreset, promptPresetChoices };
}
