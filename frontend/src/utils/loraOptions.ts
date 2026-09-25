export interface LoraSelection {
  name: string;
  strength: number;
}

export function parseLoraPrompt(value: string): { selections: LoraSelection[]; unparsed: string } {
  const selections: LoraSelection[] = [];
  const unparsed = value.replace(/<lora:([^<>:]+):([-+]?(?:\d+(?:\.\d*)?|\.\d+))>/g, (tag, name: string, weight: string) => {
    const strength = Number(weight);
    if (!Number.isFinite(strength)) return tag;
    selections.push({ name: name.replace(/\.safetensors$/, ''), strength });
    return '';
  }).replace(/[\s,;]+/g, '');
  return { selections, unparsed };
}

export function serializeLoraSelections(selections: LoraSelection[]): string {
  return selections.map(({ name, strength }) => `<lora:${name}:${strength}>`).join(' ');
}

/** `<lora:ID:0.8>` → `名称:0.8`; IDs no longer registered (e.g. retired adapters) stay as they are. */
export function formatLoraPromptForDisplay(value: string, labels: Record<string, string> = {}): string {
  return value.replace(/<lora:([^<>]+)>/g, (_tag, body: string) => {
    const split = body.lastIndexOf(':');
    if (split < 0) return body;
    const name = body.slice(0, split).replace(/\.safetensors$/, '');
    return (labels[name] ?? name) + body.slice(split);
  });
}

export function clampLoraPromptStrengths(value: string): string {
  const { selections, unparsed } = parseLoraPrompt(value);
  if (unparsed || selections.every(({ strength }) => strength >= 0 && strength <= 1)) return value;
  return serializeLoraSelections(selections.map(selection => ({
    ...selection,
    strength: Math.max(0, Math.min(1, selection.strength)),
  })));
}

export function getLoraPromptError(value: string): string | undefined {
  const { unparsed } = parseLoraPrompt(value);
  if (unparsed) return '原有 LoRA 配置无法识别，请重新选择模型';
  if (value.length > 255) return 'LoRA 配置过长，请减少模型数量';
}
