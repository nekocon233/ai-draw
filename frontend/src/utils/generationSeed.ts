import type { WorkflowMetadata, WorkflowParameter } from '../types/api';

/** JSON numbers are doubles, so a seed can only be shown and reused exactly up to this value. */
export const MAX_SEED = Number.MAX_SAFE_INTEGER;

/** An empty value means a new random seed every round. */
export type SeedValue = '' | number;

export function getSeedParameter(metadata: WorkflowMetadata | undefined): WorkflowParameter | undefined {
  return metadata?.parameters.find(parameter => parameter.type === 'seed');
}

/** A fixed seed is a safe non-negative integer; anything else means random. */
export function normalizeSeed(value: unknown): SeedValue {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : '';
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : '';
  }
  return '';
}

/** Image n of a round uses base + n, so the base leaves room for the whole batch. */
export function getMaxBaseSeed(parameter: WorkflowParameter | undefined, count: number): number {
  const maximum = Math.min(parameter?.max ?? MAX_SEED, MAX_SEED);
  return Math.max(0, maximum - (Math.max(1, Math.floor(count)) - 1));
}

/** Same 32-bit range the server draws random seeds from, so they stay short enough to read and type. */
export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/** Why a draft seed cannot start a round of `count` results; '' means random and is always valid. */
export function getSeedError(value: unknown, parameter: WorkflowParameter | undefined, count: number): string | null {
  if (value === '' || value === undefined) return null;
  if (value === null) return '请输入种子，或改为随机';
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return '种子必须是非负整数';
  const maximum = getMaxBaseSeed(parameter, count);
  if (value <= maximum) return null;
  return count > 1 ? `生成 ${count} 张时种子最大为 ${maximum}` : `种子最大为 ${maximum}`;
}

/** The fixed seed a round was sent with, or null when that round used random seeds. */
export function getFixedSeed(
  metadata: WorkflowMetadata | undefined,
  options: Record<string, unknown> | undefined,
): number | null {
  const parameter = getSeedParameter(metadata);
  const value = parameter ? normalizeSeed(options?.[parameter.name]) : '';
  return value === '' ? null : value;
}

export function readMediaSeed(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Map each result URL to its seed from the server's `seeds` list, which runs parallel to `images`. */
export function buildMediaSeeds(images: readonly unknown[] | undefined, seeds: readonly unknown[] | undefined): Record<string, number> {
  const mediaSeeds: Record<string, number> = {};
  images?.forEach((image, index) => {
    const seed = readMediaSeed(seeds?.[index]);
    if (typeof image === 'string' && seed !== null) mediaSeeds[image] = seed;
  });
  return mediaSeeds;
}

/** Seeds in the same order as the images being saved; edits and seedless results send null. */
export function alignSeeds(images: readonly string[], mediaSeeds: Record<string, number> | undefined): (number | null)[] {
  return images.map(image => mediaSeeds?.[image] ?? null);
}

/** A new session starts from random seeds in every workflow. */
export function clearFixedSeeds<T extends string | number>(
  options: Record<string, T>,
  workflows: readonly WorkflowMetadata[],
): Record<string, T | ''> {
  const next: Record<string, T | ''> = { ...options };
  for (const workflow of workflows) {
    const parameter = getSeedParameter(workflow);
    if (parameter) next[parameter.name] = '';
  }
  return next;
}
