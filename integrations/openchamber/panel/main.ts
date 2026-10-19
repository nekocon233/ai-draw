// 同一个页面有两种挂法：侧栏面板（surface = panel，完整版）和对话 Work Status 里的区块（surface = status，紧凑版）。
import { connectHost, HostRequestError, type GuestConnection, type HostReadyContext } from '@openchamber/sdk';
import { applyHostReady, mountBadge, mountButton, mountEmpty } from '@openchamber/sdk/ui';
import { AIDRAW_ORIGIN, AidrawError, createApi, type Decision, type Gate, type Slot } from './api';
import {
  ago, buildRounds, canApprove, eventLabel, orderGates, orderRounds, parseJobLog, phaseLabel, picksFromSelection, ruleText,
  selectionFromPicks, sessionJobs, sessionLabel, togglePick, type CandidateRound, type JobSummary,
} from './model';
import { GateCard, h, reconcile, type GateCardModel } from './view';

const POLL_MS = 3000;
const HIDDEN_POLL_MS = 15000;
const ROUNDS_REFRESH_TICKS = 5;      // 约 15 秒重新拉一次候选：用户在 ai-draw 里改的图会追加到原来那一轮
const JOBS_REFRESH_MS = 30000;
const SESSIONS_REFRESH_MS = 60000;
const HISTORY_LIMIT = 24;
const RECENT_MS = 10 * 60 * 1000;
const NOTIFIED_KEY = 'notified-gates';
const NOTIFIED_KEEP_MS = 7 * 24 * 3600 * 1000;
const NOTICE_MS = 8000;

interface RoundsState {
  rounds: CandidateRound[];
  primary: number;
  error: string | null;
}

interface Recent {
  gateId: string;
  title: string;
  decision: Decision;
  picks: number[];
  at: number;
}

const host = connectHost();
const api = createApi(host);
const root = document.getElementById('root');
if (!root) throw new Error('缺少 #root');

class App {
  private surface: HostReadyContext['surface'] = 'panel';
  private compact = false;
  private connection: GuestConnection = { connected: false, account: '' };
  private directory: string | null = null;
  private statusControls = false;

  private gates: Gate[] = [];
  private rounds = new Map<string, RoundsState>();
  private selections = new Map<string, string[]>();
  private pendingPicks = new Map<string, ReturnType<typeof setTimeout>>();
  private notes = new Map<string, string>();
  private noteOpen = new Set<string>();
  private showAll = new Set<string>();
  private busy = new Set<string>();
  private errors = new Map<string, string>();
  private recent: Recent[] = [];

  private sessions = new Map<string, string>();
  private sessionsAt = 0;
  private jobs: JobSummary[] = [];
  private projectSessions = new Map<string, string>();
  private jobsAt = 0;
  private jobsDirectory: string | null = null;
  private jobsNote = '';
  private collapsedProjects = new Map<string, boolean>();
  private collapseWrites = Promise.resolve();
  private slot: Slot | null = null;
  private banner: string | null = null;              // 连接问题，下一次拉取成功就清掉
  private notice: { text: string; until: number } | null = null;   // 一次性的提示，过几秒消失
  private notified: Record<string, number> | null = null;
  private badge: number | null | undefined;
  private loaded = false;
  private synced = false;                            // 第一次拉取结束之前不显示“没有待选”

  private timer: ReturnType<typeof setTimeout> | undefined;
  private ticking = false;
  private tickCount = 0;
  private cards = new Map<string, GateCard>();
  private readonly view = h('div', { class: 'app' });
  private readonly jobsTitle = h('summary', { class: 'section-title', 'aria-controls': 'project-jobs' });
  private readonly jobsContent = h('div', { id: 'project-jobs' });
  private readonly jobsSection = h('details', { class: 'jobs-section', open: true }, this.jobsTitle, this.jobsContent);

  constructor(mount: HTMLElement) {
    mount.append(this.view);
    this.jobsSection.addEventListener('toggle', () => {
      const directory = this.directory;
      const collapsed = !this.jobsSection.open;
      if (!directory || collapsed === (this.collapsedProjects.get(directory) ?? false)) return;
      this.collapsedProjects.set(directory, collapsed);
      this.jobsTitle.setAttribute('aria-expanded', String(!collapsed));
      this.collapseWrites = this.collapseWrites.then(async () => {
        await host.storage.set(await jobCollapseKey(directory), collapsed);
      }).catch(() => {
        if (this.directory !== directory) return;
        this.notice = { text: '未能保存任务列表的折叠状态，重新打开后可能需要再收起一次。', until: Date.now() + NOTICE_MS };
        this.render();
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.refresh();
    });
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.reportHeight()).observe(this.view);
    }
  }

  context(context: HostReadyContext): void {
    const first = !this.loaded;
    this.loaded = true;
    this.surface = context.surface;
    this.compact = context.surface === 'status';
    this.view.classList.toggle('compact', this.compact);
    const controls = Boolean(context.features?.statusControls) && this.compact;
    const publish = controls && !this.statusControls;
    this.statusControls = controls;
    this.connection = context.connection;
    this.setDirectory(context.directory);
    if (publish) this.publishControls();
    if (first) this.refresh();
    else this.render();
  }

  setConnection(connection: GuestConnection): void {
    const changed = connection.connected !== this.connection.connected;
    this.connection = connection;
    if (changed) {
      this.banner = null;
      this.synced = false;
      this.refresh();
    } else {
      this.render();
    }
  }

  setDirectory(directory: string | null): void {
    if (directory === this.directory) return;
    this.directory = directory;
    this.jobsAt = 0;
    this.jobs = [];
    this.projectSessions = new Map();
    this.jobsNote = '';
    if (directory && !this.compact) void this.loadJobsCollapse(directory);
    // 换项目时宿主会清掉区块头上的按钮，要重新发
    if (this.statusControls) this.publishControls();
    if (this.loaded) this.refresh();
  }

  private async loadJobsCollapse(directory: string): Promise<void> {
    if (this.collapsedProjects.has(directory)) return;
    try {
      const value = await host.storage.get(await jobCollapseKey(directory));
      if (this.directory !== directory || this.collapsedProjects.has(directory)) return;
      if (value !== undefined && typeof value !== 'boolean') throw new Error('折叠状态格式无效');
      this.collapsedProjects.set(directory, value ?? false);
    } catch {
      if (this.directory !== directory || this.collapsedProjects.has(directory)) return;
      this.notice = { text: '未能读取任务列表的折叠状态，本次先展开。', until: Date.now() + NOTICE_MS };
    }
    this.render();
  }

  private publishControls(): void {
    void host.setStatusControls([
      { kind: 'button', id: 'refresh', label: '刷新' },
      { kind: 'button', id: 'open-panel', label: '展开' },
    ]).catch(() => undefined);
  }

  private setBadge(count: number): void {
    const next = count || null;
    if (this.surface === 'panel' || next === this.badge) return;
    this.badge = next;
    void host.setBadge(next).catch(() => undefined);
  }

  control(id: string): void {
    if (id === 'refresh') this.refresh(true);
    if (id === 'open-panel') void host.openSurface('plugin:aidraw').catch(() => undefined);
  }

  refresh(force = false): void {
    if (force) {
      this.jobsAt = 0;
      this.sessionsAt = 0;
      this.rounds.clear();
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), 0);
  }

  // ---- 轮询 ----

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.loadJobs();
      if (this.connection.connected) {
        const gates = await api.openGates();
        this.banner = null;
        await this.applyGates(gates);
        if (this.tickCount % 2 === 0) this.slot = await api.slot().catch(() => this.slot);
        await this.loadSessions();
        await this.notify();
        this.tickCount++;
      }
    } catch (error) {
      this.fail(error);
    } finally {
      this.ticking = false;
      this.synced = true;
      this.render();
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.tick(), document.hidden ? HIDDEN_POLL_MS : POLL_MS);
    }
  }

  private fail(error: unknown): void {
    if (error instanceof AidrawError && error.disconnected) {
      this.banner = '令牌无效或已过期：到 设置 → 集成 → ai-draw 重新粘贴令牌。';
    } else {
      this.banner = `连不上 ai-draw：${error instanceof Error ? error.message : String(error)}。稍后自动重试。`;
    }
  }

  private async applyGates(next: Gate[]): Promise<void> {
    const previous = new Map(this.gates.map((gate) => [gate.gate_id, gate]));
    this.gates = orderGates(next, this.projectSessions);
    const live = new Set(next.map((gate) => gate.gate_id));
    for (const id of [...this.rounds.keys(), ...this.selections.keys()]) if (!live.has(id)) this.forget(id);
    const refreshRounds = this.tickCount % ROUNDS_REFRESH_TICKS === 0;
    await Promise.all(this.gates.map(async (gate) => {
      const before = previous.get(gate.gate_id);
      // 自己刚点的选择还没同步完时，不拿服务器上的旧选择覆盖
      if (!this.pendingPicks.has(gate.gate_id) && !this.busy.has(gate.gate_id)
        && (!before || before.updated_at !== gate.updated_at || !this.selections.has(gate.gate_id))) {
        this.selections.set(gate.gate_id, selectionFromPicks(gate.picks));
      }
      const changedRounds = before && before.rounds.join() !== gate.rounds.join();
      if (!this.rounds.has(gate.gate_id) || changedRounds || refreshRounds) await this.loadRounds(gate);
    }));
  }

  private async loadRounds(gate: Gate): Promise<void> {
    try {
      const history = await api.history(gate.session_id, HISTORY_LIMIT);
      const messages = [...history.messages];
      const have = new Set(messages.map((message) => message.id));
      // 关卡建议的轮次比最近的历史还早时，单独取
      const missing = gate.rounds.filter((id) => !have.has(id)).slice(0, 8);
      for (const list of await Promise.all(missing.map((id) => api.round(gate.session_id, id).catch(() => [])))) messages.push(...list);
      const rounds = orderRounds(buildRounds(messages), gate.rounds);
      const suggested = rounds.filter((round) => gate.rounds.includes(round.messageId)).length;
      this.rounds.set(gate.gate_id, { rounds, primary: suggested || 1, error: null });
    } catch (error) {
      const current = this.rounds.get(gate.gate_id);
      if (current?.rounds.length) return;   // 偶尔拉失败时保留上一次的候选
      this.rounds.set(gate.gate_id, { rounds: [], primary: 1, error: `候选没载入：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  private async loadSessions(): Promise<void> {
    const wanted = [...this.gates.map((gate) => gate.session_id), ...(this.slot?.busy && this.slot.mine ? [this.slot.session_id] : [])];
    const unknown = wanted.some((id) => !this.sessions.has(id));
    if (!unknown || Date.now() - this.sessionsAt < SESSIONS_REFRESH_MS) return;
    this.sessionsAt = Date.now();
    try {
      for (const session of await api.sessions()) this.sessions.set(session.id, session.title);
    } catch {
      // 标题拿不到就用任务名或会话 ID
    }
  }

  private async loadJobs(): Promise<void> {
    const directory = this.directory;
    if (!directory) {
      this.jobs = [];
      this.projectSessions = new Map();
      this.jobsNote = '';
      return;
    }
    if (directory === this.jobsDirectory && Date.now() - this.jobsAt < JOBS_REFRESH_MS) return;
    this.jobsAt = Date.now();
    this.jobsDirectory = directory;
    try {
      const { entries } = await host.listDir('art/jobs');
      if (this.directory !== directory) return;
      const files = entries.filter((entry) => entry.kind === 'file' && entry.name.endsWith('.jsonl'));
      const jobs = await Promise.all(files.map(async (entry) => {
        try {
          const { content } = await host.readFile(`art/jobs/${entry.name}`);
          return parseJobLog(entry.name.replace(/\.jsonl$/, ''), content);
        } catch {
          return null;
        }
      }));
      if (this.directory !== directory) return;
      this.jobs = jobs.filter((job): job is JobSummary => job !== null).sort((a, b) => b.lastTs - a.lastTs);
      this.jobsNote = this.jobs.length ? '' : '这个项目的 art/jobs 里还没有任务。';
    } catch (error) {
      if (this.directory !== directory) return;
      this.jobs = [];
      const code = (error as { code?: string }).code;
      this.jobsNote = code === 'NOT_FOUND' ? '这个项目没有 art/jobs，素材任务列表为空。'
        : code === 'NOT_GRANTED' ? '没有读取项目文件的权限：到 设置 → 扩展 → ai-draw 批准 files。'
          : '';
    }
    this.projectSessions = sessionJobs(this.jobs);
    this.gates = orderGates(this.gates, this.projectSessions);
  }

  // ---- 提醒：Work Status 区块里弹通知、给侧栏图标加角标；侧栏面板开着时只记下已经看过 ----

  private async notify(): Promise<void> {
    if (this.notified === null) {
      const stored = await host.storage.get(NOTIFIED_KEY).catch(() => undefined);
      this.notified = stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...(stored as Record<string, number>) } : {};
    }
    const notified = this.notified;
    this.setBadge(this.gates.length);
    const fresh = this.gates.filter((gate) => !(gate.gate_id in notified));
    if (!fresh.length) return;
    const now = Date.now();
    for (const gate of fresh) notified[gate.gate_id] = now;
    const live = new Set(this.gates.map((gate) => gate.gate_id));
    for (const [id, at] of Object.entries(notified)) if (!live.has(id) && now - at > NOTIFIED_KEEP_MS) delete notified[id];
    await host.storage.set(NOTIFIED_KEY, notified).catch(() => undefined);
    if (this.surface === 'panel') return;
    for (const gate of fresh) {
      await host.toast({ kind: 'info', message: `ai-draw：${this.titleOf(gate)} 等你挑选（${ruleText(gate)}）`, persistent: true }).catch(() => undefined);
    }
  }

  // ---- 操作 ----

  private toggle(gate: Gate, key: string): void {
    const id = gate.gate_id;
    if (this.busy.has(id) || gate.max_picks === 0) return;
    const before = this.selections.get(id) ?? [];
    const after = togglePick(before, key, gate.max_picks);
    if (after === before) {
      this.errors.set(id, `最多选 ${gate.max_picks} 个，先取消一个`);
      this.render();
      return;
    }
    this.selections.set(id, after);
    this.errors.delete(id);
    this.render();
    clearTimeout(this.pendingPicks.get(id));
    // 选择同步到 ai-draw，网页上也能看到；连着点只发最后一次
    this.pendingPicks.set(id, setTimeout(() => {
      const picks = picksFromSelection(after, this.rounds.get(id)?.rounds ?? []);
      void api.setPicks(id, picks).catch((error: unknown) => {
        if (error instanceof AidrawError && error.status === 409) this.closedElsewhere(id);
        else this.errors.set(id, `选择没同步到 ai-draw：${error instanceof Error ? error.message : String(error)}`);
      }).finally(() => {
        this.pendingPicks.delete(id);
        this.render();
      });
    }, 400));
  }

  private async submit(gate: Gate, decision: Decision): Promise<void> {
    const id = gate.gate_id;
    if (this.busy.has(id)) return;
    const note = (this.notes.get(id) ?? '').trim();
    if (decision === 'redo' && !note) {
      this.errors.set(id, '写一句要改什么，agent 才知道怎么重来。');
      this.noteOpen.add(id);
      this.render();
      this.cards.get(id)?.focusNote();
      return;
    }
    const rounds = this.rounds.get(id)?.rounds ?? [];
    const selection = this.selections.get(id) ?? [];
    const picks = decision === 'approve' ? picksFromSelection(selection, rounds) : [];
    if (decision === 'approve' && !canApprove(gate, picks.length)) {
      this.errors.set(id, `这个审核要求：${ruleText(gate)}。`);
      this.render();
      return;
    }
    clearTimeout(this.pendingPicks.get(id));
    this.pendingPicks.delete(id);
    this.busy.add(id);
    this.errors.delete(id);
    this.render();
    try {
      await api.submit(id, decision, picks, note);
      const numbers = new Map(rounds.flatMap((round) => round.items).map((item) => [item.key, item.number]));
      this.recent.unshift({ gateId: id, title: this.titleOf(gate), decision, picks: selection.map((key) => numbers.get(key) ?? 0).filter(Boolean), at: Date.now() });
      this.gates = this.gates.filter((item) => item.gate_id !== id);
      this.forget(id);
      this.setBadge(this.gates.length);
    } catch (error) {
      if (error instanceof AidrawError && error.status === 409) this.closedElsewhere(id);
      else this.errors.set(id, `提交失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.busy.delete(id);
      this.render();
    }
  }

  private closedElsewhere(id: string): void {
    this.gates = this.gates.filter((gate) => gate.gate_id !== id);
    this.forget(id);
    this.notice = { text: '这个审核已经结束了（可能已在 ai-draw 网页里提交，或被 agent 撤销）。', until: Date.now() + NOTICE_MS };
  }

  private forget(id: string): void {
    this.rounds.delete(id);
    this.selections.delete(id);
    clearTimeout(this.pendingPicks.get(id));
    this.pendingPicks.delete(id);
    this.notes.delete(id);
    this.noteOpen.delete(id);
    this.showAll.delete(id);
    this.errors.delete(id);
    const card = this.cards.get(id);
    card?.root.remove();
    this.cards.delete(id);
  }

  private sessionUrl(sessionId: string): string {
    return `${AIDRAW_ORIGIN}/?session=${encodeURIComponent(sessionId)}`;
  }

  private async openTab(sessionId: string): Promise<void> {
    try {
      await host.openBrowser(this.sessionUrl(sessionId));
    } catch (error) {
      const text = error instanceof HostRequestError && error.code === 'UNSUPPORTED'
        ? '当前 OpenChamber 不支持直接打开浏览器标签，请更新 OpenChamber，或点击“新窗口”。'
        : error instanceof HostRequestError && error.code === 'NO_DIRECTORY'
          ? '请先打开一个项目，再打开 ai-draw 会话。'
          : `打开会话失败：${error instanceof Error ? error.message : String(error)}`;
      this.notice = { text, until: Date.now() + NOTICE_MS };
      this.render();
    }
  }

  private openWindow(sessionId: string): void {
    void host.openUrl(this.sessionUrl(sessionId)).catch(() => undefined);
  }

  private titleOf(gate: Gate): string {
    return gate.job || this.projectSessions.get(gate.session_id) || sessionLabel(this.sessions.get(gate.session_id)) || '审核';
  }

  // ---- 画 ----

  private reportHeight(): void {
    if (this.compact) void host.setHeight(Math.ceil(this.view.getBoundingClientRect().height) + 2).catch(() => undefined);
  }

  render(): void {
    const parts: Node[] = [];
    if (!this.compact) parts.push(this.header());
    if (!this.connection.connected) {
      parts.push(this.disconnected());
      reconcile(this.view, parts);
      this.reportHeight();
      return;
    }
    if (!this.synced) {
      parts.push(h('div', { class: 'muted', text: '正在载入 ai-draw…' }));
      reconcile(this.view, parts);
      this.reportHeight();
      return;
    }
    if (this.banner) parts.push(h('div', { class: 'banner', role: 'status', text: this.banner }));
    if (this.notice && this.notice.until > Date.now()) parts.push(h('div', { class: 'notice', role: 'status', text: this.notice.text }));
    else this.notice = null;

    const cards = this.compact ? this.gates.slice(0, 1) : this.gates;
    if (!this.compact) parts.push(h('h2', { class: 'section-title', text: this.gates.length ? `待选（${this.gates.length}）` : '待选' }));
    for (const gate of cards) parts.push(this.card(gate).root);
    if (this.compact && this.gates.length > 1) {
      const more = h('button', { type: 'button', class: 'link', text: `还有 ${this.gates.length - 1} 个待选 · 展开` });
      more.addEventListener('click', () => this.control('open-panel'));
      parts.push(more);
    }
    const slot = this.slotLine();
    if (!this.gates.length) {
      if (this.compact) parts.push(slot ?? h('div', { class: 'muted', text: this.idleLine() }));
      else parts.push(h('div', { class: 'muted', text: '没有待选的素材。agent 开审核关卡时会出现在这里。' }));
    }
    if (!this.compact) {
      if (slot) parts.push(h('h2', { class: 'section-title', text: '生成' }), slot);
      parts.push(...this.recentList(), ...this.jobList());
    }
    reconcile(this.view, parts);
    this.reportHeight();
  }

  private header(): HTMLElement {
    const bar = h('header', { class: 'top' }, h('strong', { class: 'brand', text: 'ai-draw' }));
    mountBadge(bar, this.connection.connected
      ? { label: this.connection.account ? `已连接 · ${this.connection.account}` : '已连接', tone: 'success' }
      : { label: '未连接', tone: 'warning' });
    const spacer = h('span', { class: 'grow' });
    bar.append(spacer);
    mountButton(bar, { label: '刷新', variant: 'ghost', size: 'sm', onClick: () => this.refresh(true) });
    return bar;
  }

  private disconnected(): HTMLElement {
    if (this.compact) return h('div', { class: 'muted', text: 'ai-draw 未连接：到 设置 → 集成 → ai-draw 粘贴令牌。' });
    const box = h('div');
    mountEmpty(box, { title: '还没连接 ai-draw', body: '到 设置 → 集成 → ai-draw 粘贴个人访问令牌（aidp_ 开头）。令牌怎么生成见扩展目录里的 README。' });
    return box;
  }

  private idleLine(): string {
    const latest = this.jobs[0];
    if (!latest) return 'ai-draw：没有待选的素材';
    return `ai-draw：没有待选的 · 最近 ${latest.name} ${eventLabel(latest.lastEvent)}（${ago(latest.lastTs)}）`;
  }

  private slotLine(): HTMLElement | null {
    const slot = this.slot;
    if (!slot?.busy) return null;
    if (!slot.mine) return h('div', { class: 'muted', text: '生成槽正被别的账号使用。' });
    const job = this.projectSessions.get(slot.session_id) ?? sessionLabel(this.sessions.get(slot.session_id));
    const started = this.jobs.map((item) => item.taskStarted[slot.task_id]).find((value) => value !== undefined);
    const elapsed = started ? ` · 已用 ${formatElapsed(Date.now() - started)}` : '';
    const count = slot.artifact_count ? ` · 已出 ${slot.artifact_count} 个` : '';
    return h('div', { class: 'slot', role: 'status' }, h('span', { class: 'pulse', 'aria-hidden': 'true' }),
      h('span', { text: `${phaseLabel(slot.phase)}${job ? ` · ${job}` : ''}${elapsed}${count}` }));
  }

  private recentList(): Node[] {
    const now = Date.now();
    this.recent = this.recent.filter((item) => now - item.at < RECENT_MS).slice(0, 5);
    if (!this.recent.length) return [];
    return [
      h('h2', { class: 'section-title', text: '刚提交的' }),
      h('ul', { class: 'list' }, ...this.recent.map((item) => h('li', {}, h('strong', { text: item.title }), h('span', { class: 'muted', text:
        ` · ${item.decision === 'redo' ? '重来' : item.picks.length ? `选了 ${item.picks.map((number) => `#${number}`).join('、')}` : '确认'} · ${ago(item.at)} · agent 收到后会在对话里接着做` })))),
    ];
  }

  private jobList(): Node[] {
    const expanded = !(this.collapsedProjects.get(this.directory ?? '') ?? false);
    this.jobsSection.open = expanded;
    this.jobsTitle.textContent = `本项目的素材任务（${this.jobs.length}）`;
    this.jobsTitle.setAttribute('aria-expanded', String(expanded));
    if (!this.directory || !this.jobs.length) {
      this.jobsContent.replaceChildren(h('div', { class: 'muted', text: !this.directory
        ? '打开一个项目后显示它的素材任务。' : this.jobsNote || '没有任务。' }));
      return [this.jobsSection];
    }
    const list = h('ul', { class: 'list jobs' });
    for (const job of this.jobs.slice(0, 20)) {
      const delivered = job.delivered.length ? ` · 交付 ${job.delivered.slice(0, 3).join('、')}${job.delivered.length > 3 ? ' 等' : ''}` : '';
      const row = h('li', {}, h('div', { class: 'grow' }, h('strong', { text: job.name }),
        h('span', { class: 'muted', text: ` · ${eventLabel(job.lastEvent)} · ${ago(job.lastTs)}${delivered}` })));
      if (job.sessionId) {
        const sessionId = job.sessionId;
        mountButton(row, { label: '打开会话', variant: 'ghost', size: 'xs', onClick: () => void this.openTab(sessionId) });
      }
      list.append(row);
    }
    this.jobsContent.replaceChildren(list);
    return [this.jobsSection];
  }

  private card(gate: Gate): GateCard {
    const id = gate.gate_id;
    const state = this.rounds.get(id);
    const model: GateCardModel = {
      gate,
      title: this.titleOf(gate),
      project: this.projectSessions.has(gate.session_id),
      rounds: state ? state.rounds : null,
      primary: state?.primary ?? 1,
      showAll: this.showAll.has(id),
      roundsError: state?.error ?? null,
      selection: this.selections.get(id) ?? [],
      note: this.notes.get(id) ?? '',
      busy: this.busy.has(id),
      error: this.errors.get(id) ?? null,
      compact: this.compact,
      noteOpen: this.noteOpen.has(id),
    };
    let card = this.cards.get(id);
    if (card) {
      card.update(model);
      return card;
    }
    card = new GateCard(model, {
      toggle: (key) => this.toggle(this.gate(id) ?? gate, key),
      note: (value) => { this.notes.set(id, value); },
      approve: () => void this.submit(this.gate(id) ?? gate, 'approve'),
      redo: () => void this.submit(this.gate(id) ?? gate, 'redo'),
      showAll: () => { this.showAll.add(id); this.render(); },
      openNote: () => { this.noteOpen.add(id); this.render(); this.cards.get(id)?.focusNote(); },
      openTab: () => void this.openTab(gate.session_id),
      openWindow: () => this.openWindow(gate.session_id),
      expand: () => this.control('open-panel'),
    });
    this.cards.set(id, card);
    return card;
  }

  private gate(id: string): Gate | undefined {
    return this.gates.find((gate) => gate.gate_id === id);
  }
}

async function jobCollapseKey(directory: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(directory));
  return `jobs-collapsed:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

const app = new App(root);
// Work Status 区块头上的按钮：要在 connectHost 之后马上注册
host.onStatusControl((event) => app.control(event.id));
host.onReady((context) => {
  applyHostReady(context, document.documentElement);
  app.context(context);
});
host.onConnection((connection) => app.setConnection(connection));
host.onDirectory((directory) => app.setDirectory(directory));
