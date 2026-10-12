import type { PickInput, ReviewGate } from './types.ts';

type GateLimits = Pick<ReviewGate, 'min_picks' | 'max_picks'>;

export function samePick(a: PickInput, b: PickInput): boolean {
  return a.url === b.url && (!a.message_id || !b.message_id || a.message_id === b.message_id);
}

export function isPicked(picks: readonly PickInput[], pick: PickInput): boolean {
  return picks.some(item => samePick(item, pick));
}

/**
 * Select or unselect one result. With a single allowed pick a new choice replaces the old one;
 * otherwise null means the limit is already reached.
 */
export function togglePick(picks: readonly PickInput[], pick: PickInput, maxPicks: number): PickInput[] | null {
  if (isPicked(picks, pick)) return picks.filter(item => !samePick(item, pick));
  if (maxPicks <= 0) return null;
  if (maxPicks === 1) return [pick];
  if (picks.length >= maxPicks) return null;
  return [...picks, pick];
}

export function canApprove(gate: GateLimits, count: number): boolean {
  return gate.max_picks === 0 ? count === 0 : count >= gate.min_picks && count <= gate.max_picks;
}

/** Why approving is not possible yet, or null when it is. */
export function approveBlocker(gate: GateLimits, count: number): string | null {
  if (canApprove(gate, count)) return null;
  if (gate.max_picks === 0) return '这个审核只需确认，先取消已选的结果';
  if (count < gate.min_picks) return `先在上方结果右上角点「选用」，${pickRequirement(gate)}`;
  return `最多选 ${gate.max_picks} 个，先取消多余的`;
}

export function pickSummary(gate: GateLimits, count: number): string {
  if (gate.max_picks === 0) return '等你确认';
  return count === 0 ? `还没选（${pickRequirement(gate)}）` : `已选 ${count}/${gate.max_picks}`;
}

export function pickRequirement(gate: GateLimits): string {
  if (gate.max_picks === 0) return '确认后继续';
  if (gate.min_picks === gate.max_picks) return `选 ${gate.max_picks} 个`;
  if (gate.min_picks === 0) return `最多选 ${gate.max_picks} 个`;
  return `选 ${gate.min_picks}–${gate.max_picks} 个`;
}
