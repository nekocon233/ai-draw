// DOM：关卡卡片、候选格子、放大预览。状态都在 main.ts，这里只负责画和把点击交回去。
import { mountButton } from '@openchamber/sdk/ui';
import type { Gate } from './api';
import { ago, approveLabel, canApprove, ruleText, type Candidate, type CandidateRound } from './model';

type Props = Record<string, string | boolean | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Array<Node | string | null | undefined>): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child !== null && child !== undefined) node.append(child);
  return node;
}

/**
 * 让 container 的子节点变成 nodes，已经在对的位置上的节点不挪动。
 * 关卡卡片每次重画都复用同一个节点，不挪动它，正在输入的意见框就不会丢焦点、打断输入法。
 */
export function reconcile(container: Element, nodes: Node[]): void {
  // 先删掉不要的，留下的节点相对顺序不变；再按顺序插入新节点，插入不会挪动已有节点
  const keep = new Set(nodes);
  for (const child of [...container.childNodes]) if (!keep.has(child)) child.remove();
  nodes.forEach((node, index) => {
    const current = container.childNodes[index];
    if (current !== node) container.insertBefore(node, current ?? null);
  });
}

// ---- 放大预览：盖住整个面板，点一下或按 Esc 关掉 ----

let overlay: HTMLElement | null = null;

export function showPreview(item: Candidate, caption: string): void {
  closePreview();
  const media = item.video
    ? h('video', { src: item.src, controls: true, autoplay: true, loop: true, muted: true, playsinline: true })
    : h('img', { src: item.src, alt: `#${item.number}` });
  overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-label': `#${item.number} 大图` }, media, h('div', { class: 'overlay-caption', text: caption }));
  overlay.addEventListener('click', closePreview);
  document.body.append(overlay);
}

export function closePreview(): void {
  overlay?.remove();
  overlay = null;
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closePreview();
});

// ---- 一个候选格子 ----

// 只预读元数据时，有的浏览器在播放前不画画面；带上 #t=0.1 让格子先显示开头的一帧
const firstFrame = (src: string): string => (src.startsWith('data:') || src.includes('#') ? src : `${src}#t=0.1`);

function tile(item: Candidate, selectable: boolean, onToggle: () => void, onZoom: () => void): { root: HTMLElement; setSelected(selected: boolean): void } {
  const media = item.video
    ? h('video', { src: firstFrame(item.src), muted: true, loop: true, playsinline: true, preload: 'metadata' })
    : h('img', { src: item.src, alt: `#${item.number}`, loading: 'lazy', decoding: 'async' });
  const pick = h('button', { type: 'button', class: 'tile-pick', 'aria-pressed': 'false', disabled: !selectable, title: selectable ? `选用 #${item.number}` : `#${item.number}` },
    media, h('span', { class: 'tile-number', text: `#${item.number}` }), h('span', { class: 'tile-check', text: '✓', 'aria-hidden': 'true' }));
  const zoom = h('button', { type: 'button', class: 'tile-zoom', title: '放大', 'aria-label': `放大 #${item.number}`, text: '⤢' });
  const root = h('div', { class: item.video ? 'tile video' : 'tile' }, pick, zoom);
  pick.addEventListener('click', onToggle);
  zoom.addEventListener('click', onZoom);
  if (media instanceof HTMLVideoElement) {
    root.addEventListener('mouseenter', () => { void media.play().catch(() => undefined); });
    root.addEventListener('mouseleave', () => { media.pause(); });
  }
  return {
    root,
    setSelected(selected) {
      root.classList.toggle('selected', selected);
      pick.setAttribute('aria-pressed', String(selected));
    },
  };
}

// ---- 关卡卡片 ----

export interface GateCardModel {
  gate: Gate;
  title: string;
  project: boolean;
  rounds: CandidateRound[] | null;   // null：还在加载
  primary: number;                   // 前几轮是关卡建议的（或最新的一轮），其余收在“更早的结果”里
  showAll: boolean;
  roundsError: string | null;
  selection: string[];
  note: string;
  busy: boolean;
  error: string | null;
  compact: boolean;
  noteOpen: boolean;                 // 紧凑模式下意见框是否展开
}

export interface GateCardActions {
  toggle(key: string): void;
  note(value: string): void;
  approve(): void;
  redo(): void;
  showAll(): void;
  openNote(): void;
  openTab(): void;
  openWindow(): void;
  expand(): void;
}

export class GateCard {
  readonly root: HTMLElement;
  private readonly titleNode = h('strong', { class: 'gate-title' });
  private readonly scopeNode = h('span', { class: 'gate-scope' });
  private readonly metaNode = h('div', { class: 'gate-meta' });
  private readonly questionNode = h('p', { class: 'gate-question' });
  private readonly roundsNode = h('div', { class: 'rounds' });
  private readonly moreNode = h('button', { type: 'button', class: 'link more' });
  private readonly noteNode = h('textarea', { class: 'note', rows: '2' });
  private readonly errorNode = h('div', { class: 'gate-error', role: 'alert' });
  private readonly actionsNode = h('div', { class: 'actions' });
  private readonly approveButton: ReturnType<typeof mountButton>;
  private readonly redoButton: ReturnType<typeof mountButton>;
  private readonly extraButtons: Array<ReturnType<typeof mountButton>> = [];
  private tiles = new Map<string, ReturnType<typeof tile>>();
  private signature = '';
  private model: GateCardModel;

  constructor(model: GateCardModel, private readonly actions: GateCardActions) {
    this.model = model;
    this.root = h('section', { class: 'gate' },
      h('header', { class: 'gate-head' }, h('div', { class: 'gate-line' }, this.titleNode, this.scopeNode), this.metaNode),
      this.questionNode, this.roundsNode, this.moreNode, this.noteNode, this.errorNode, this.actionsNode);
    this.moreNode.addEventListener('click', () => actions.showAll());
    this.noteNode.addEventListener('input', () => actions.note(this.noteNode.value));
    // 输入框里的按键不要冒泡到别的快捷键
    this.noteNode.addEventListener('keydown', (event) => event.stopPropagation());
    this.approveButton = mountButton(this.actionsNode, { label: '提交', onClick: () => actions.approve() });
    this.redoButton = mountButton(this.actionsNode, { label: '都不满意，重来', variant: 'outline', onClick: () => (this.model.compact && !this.model.noteOpen ? actions.openNote() : actions.redo()) });
    if (model.compact) {
      this.extraButtons.push(mountButton(this.actionsNode, { label: '展开', variant: 'ghost', onClick: () => actions.expand() }));
    } else {
      this.extraButtons.push(mountButton(this.actionsNode, { label: '在浏览器标签打开', variant: 'ghost', onClick: () => actions.openTab() }));
      this.extraButtons.push(mountButton(this.actionsNode, { label: '新窗口', variant: 'ghost', onClick: () => actions.openWindow() }));
    }
    this.update(model);
  }

  update(model: GateCardModel): void {
    this.model = model;
    const { gate } = model;
    this.root.classList.toggle('compact', model.compact);
    this.titleNode.textContent = model.title;
    this.scopeNode.textContent = model.project ? '' : '其他项目';
    this.scopeNode.hidden = model.project;
    const opened = gate.created_at ? ago(gate.created_at) : '';
    this.metaNode.textContent = [opened, ruleText(gate), model.selection.length && gate.max_picks ? `已选 ${model.selection.length}` : ''].filter(Boolean).join(' · ');
    this.questionNode.textContent = gate.question;
    this.renderRounds(model);

    this.noteNode.placeholder = model.compact ? '要改什么？' : '意见（可选；重来时写清楚要改什么）';
    this.noteNode.hidden = model.compact && !model.noteOpen;
    if (document.activeElement !== this.noteNode && this.noteNode.value !== model.note) this.noteNode.value = model.note;
    this.noteNode.disabled = model.busy;

    this.errorNode.textContent = model.error ?? '';
    this.errorNode.hidden = !model.error;

    const count = model.selection.length;
    this.approveButton.update({ label: approveLabel(gate, count), disabled: model.busy || !canApprove(gate, count), loading: model.busy });
    this.redoButton.update({ label: model.compact && model.noteOpen ? '确认重来' : '都不满意，重来', disabled: model.busy });
    for (const button of this.extraButtons) button.update({ disabled: model.busy });
  }

  focusNote(): void {
    this.noteNode.hidden = false;
    this.noteNode.focus();
  }

  private renderRounds(model: GateCardModel): void {
    const { rounds } = model;
    if (rounds === null || model.roundsError || !rounds.length) {
      this.signature = '';
      this.tiles.clear();
      this.roundsNode.replaceChildren(h('div', { class: 'muted', text: model.roundsError ?? (rounds === null ? '正在载入候选…' : model.gate.max_picks === 0 ? '' : '会话里还没有结果') }));
      this.moreNode.hidden = true;
      return;
    }
    const visible = model.showAll || model.compact ? rounds : rounds.slice(0, Math.max(1, model.primary));
    const shown = model.compact ? visible.slice(0, Math.max(1, model.primary)) : visible;
    const signature = `${model.compact}|${shown.map((round) => `${round.messageId}:${round.items.map((item) => item.key).join(',')}`).join(';')}`;
    if (signature !== this.signature) {
      this.signature = signature;
      this.tiles.clear();
      const selectable = model.gate.max_picks > 0 && !model.busy;
      this.roundsNode.replaceChildren(...shown.map((round) => {
        const grid = h('div', { class: 'tiles' });
        for (const item of round.items) {
          const view = tile(item, selectable, () => this.actions.toggle(item.key), () => showPreview(item, `#${item.number}${round.text ? ` · ${round.text}` : ''}`));
          this.tiles.set(item.key, view);
          grid.append(view.root);
        }
        return h('div', { class: 'round' }, model.compact || !round.text ? null : h('div', { class: 'round-text', text: round.text }), grid);
      }));
    }
    const chosen = new Set(model.selection);
    for (const [key, view] of this.tiles) view.setSelected(chosen.has(key));
    const hidden = rounds.length - visible.length;
    this.moreNode.hidden = model.compact || hidden <= 0;
    this.moreNode.textContent = `显示更早的结果（${hidden} 轮）`;
  }
}
