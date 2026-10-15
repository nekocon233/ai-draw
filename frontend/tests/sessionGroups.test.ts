import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import type { AppState } from '../src/stores/appStore.ts';
import type { apiService } from '../src/api/services.ts';
import type { ChatSession, ChatSessionGroup } from '../src/types/models.ts';
import { buildSessionSections } from '../src/utils/sessionGroups.ts';

const bundle = buildSync({
  stdin: {
    contents: 'import {useAppStore} from "./src/stores/appStore.ts"; import {apiService} from "./src/api/services.ts"; globalThis.qa={store:useAppStore,api:apiService};',
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
  },
  bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent',
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"DEV":false,"PROD":true}' },
}).outputFiles[0].text;
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const group = (id: number, extra: Partial<ChatSessionGroup> = {}): ChatSessionGroup => ({
  id, name: `项目 ${id}`, is_pinned: false, is_collapsed: false, created_at: id, ...extra,
});
const session = (id: string, groupId: number | null, extra: Partial<ChatSession> = {}): ChatSession => ({
  id, title: id, group_id: groupId, is_pinned: false, created_at: 1, updated_at: 1, message_count: 2, ...extra,
});

function fixture() {
  const storage = new Map([['access_token', 'qa.' + btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 })) + '.qa']]);
  const sandbox = vm.createContext({
    window: { setTimeout, clearTimeout }, setTimeout, clearTimeout,
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    console: { ...console, error: () => {} }, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController,
    atob, btoa, structuredClone, crypto: globalThis.crypto,
  });
  vm.runInContext(bundle, sandbox);
  const { store, api } = sandbox.qa as { store: { getState(): AppState; setState(value: Partial<AppState>): void }; api: typeof apiService };
  api.updateUserConfig = async () => ({ message: 'saved' });
  api.updateSessionConfig = async () => ({ message: 'saved' });
  api.getSessions = async () => [session('A', 1)];
  api.getSessionGroups = async () => [group(1), group(2)];
  api.getUserConfig = async () => ({ current_workflow: 'gpt_image', prompt: '', lora_prompt: '', strength: 1,
    count: 1, images_per_row: 4, updated_at: '', current_session_id: 'A', ungrouped_collapsed: true });
  api.updateSessionGroup = async (id, update) => ({ ...store.getState().sessionGroups.find(g => g.id === id)!, ...update });
  api.moveSessionToGroup = async (_id, groupId) => ({ group_id: groupId });
  api.deleteSessionGroup = async () => ({ deleted: true });
  store.setState({ sessions: [session('A', 1, { is_pinned: true }), session('B', null)], sessionGroups: [group(1), group(2)],
    currentSessionId: 'A', composerSessionId: 'A', sessionConfigStatus: 'ready', currentWorkflow: 'gpt_image',
    availableWorkflows: [{ key: 'gpt_image', label: 'GPT', description: '', category: '生图', output_type: 'image', requires_image: false, parameters: [] }],
    prompt: '未发送的描述', referenceImages: ['reference.png'],
    chatHistory: [{ id: 'reply', session_id: 'A', type: 'assistant', content: '', images: ['result.png'], timestamp: 1 }],
    isGenerating: true, currentGenerationTaskId: 'task-A', currentGeneratingMessageId: 'reply',
  });
  return { store, api, close: () => store.getState().reset() };
}

test('project order is stable, pins stay inside their project, and legacy or orphan sessions are ungrouped', () => {
  const sessions = [session('new', 1, { updated_at: 9 }), session('pinned', 1, { is_pinned: true }),
    session('legacy', null), session('orphan', 99), session('other', 2)];
  const groups = [group(2, { is_pinned: true, is_collapsed: true }), group(3), group(1)];
  const result = buildSessionSections(sessions, groups, true);
  assert.deepEqual(result.map(section => section.id), [2, 1, 3, null]);
  assert.deepEqual(result[1].sessions.map(item => item.id), ['pinned', 'new']);
  assert.deepEqual(result[3].sessions.map(item => item.id), ['legacy', 'orphan']);
  assert.equal(result[0].is_collapsed, true);
  assert.equal(result[3].is_collapsed, true);
  assert.equal(result[2].sessions.length, 0);
  assert.deepEqual(groups.map(item => item.id), [2, 3, 1], 'does not sort source state in place');
});

test('refresh restores saved folder state without switching the conversation or its composer', async t => {
  const f = fixture(); t.after(f.close);
  f.api.getSessionGroups = async () => [group(1, { is_pinned: true, is_collapsed: true })];
  await f.store.getState().refreshSessionNavigation();
  const state = f.store.getState();
  assert.equal(state.sessionGroups[0].is_collapsed, true);
  assert.equal(state.ungroupedCollapsed, true);
  assert.equal(state.currentSessionId, 'A');
  assert.equal(state.prompt, '未发送的描述');
  assert.equal(state.currentGenerationTaskId, 'task-A');
});

test('moving the generating conversation expands its destination and preserves its input, media and activity', async t => {
  const f = fixture(); t.after(f.close);
  f.store.setState({ sessionGroups: [group(1), group(2, { is_collapsed: true })] });
  const before = f.store.getState();
  assert.equal(await before.moveSessionToGroup('A', 2), true);
  const after = f.store.getState();
  assert.equal(after.sessions[0].group_id, 2);
  assert.equal(after.sessions[0].is_pinned, true);
  assert.equal(after.sessions[0].updated_at, 1);
  assert.equal(after.sessionGroups[1].is_collapsed, false);
  assert.equal(after.prompt, before.prompt);
  assert.equal(after.referenceImages, before.referenceImages);
  assert.equal(after.chatHistory, before.chatHistory);
  assert.equal(after.currentGenerationTaskId, before.currentGenerationTaskId);
});

test('failed moves restore assignment and collapse state, and a retry clears the error', async t => {
  const f = fixture(); t.after(f.close);
  f.store.setState({ sessionGroups: [group(1), group(2, { is_collapsed: true })] });
  f.api.moveSessionToGroup = async () => { throw new Error('offline'); };
  assert.equal(await f.store.getState().moveSessionToGroup('A', 2), false);
  assert.equal(f.store.getState().sessions[0].group_id, 1);
  assert.equal(f.store.getState().sessionGroups[1].is_collapsed, true);
  assert.equal(f.store.getState().sessionNavigationError, 'offline');
  f.api.moveSessionToGroup = async (_id, groupId) => ({ group_id: groupId });
  assert.equal(await f.store.getState().moveSessionToGroup('A', null), true);
  assert.equal(f.store.getState().sessionNavigationError, null);
  assert.equal(f.store.getState().ungroupedCollapsed, false);
});

test('collapse changes are saved in order so an older response cannot undo a later choice', async t => {
  const f = fixture(); t.after(f.close);
  const first = deferred<ChatSessionGroup>();
  const writes: boolean[] = [];
  f.api.updateSessionGroup = async (id, update) => {
    writes.push(update.is_collapsed!);
    return writes.length === 1 ? first.promise : group(id, update);
  };
  const close = f.store.getState().updateSessionGroup(1, { is_collapsed: true });
  const open = f.store.getState().updateSessionGroup(1, { is_collapsed: false });
  await tick();
  assert.deepEqual(writes, [true]);
  first.resolve(group(1, { is_collapsed: true }));
  await Promise.all([close, open]);
  assert.deepEqual(writes, [true, false]);
  assert.equal(f.store.getState().sessionGroups[0].is_collapsed, false);
  assert.equal(f.store.getState().sessionNavigationPending, 0);
});

test('a list fetched before a move is discarded and refreshed instead of undoing the move', async t => {
  const f = fixture(); t.after(f.close);
  const stale = deferred<ChatSession[]>(); let reads = 0;
  f.api.getSessions = async () => ++reads === 1 ? stale.promise : [session('A', 2)];
  const loading = f.store.getState().refreshSessionNavigation();
  await tick();
  await f.store.getState().moveSessionToGroup('A', 2);
  stale.resolve([session('A', 1)]);
  await loading;
  assert.equal(reads, 2);
  assert.equal(f.store.getState().sessions[0].group_id, 2);
});

test('new conversations inherit the current project and can explicitly target ungrouped or another project', async t => {
  const f = fixture(); t.after(f.close);
  const destinations: (number | null | undefined)[] = [];
  f.api.createSession = async (_title, groupId) => {
    destinations.push(groupId);
    return { session_id: `new-${destinations.length}`, title: 'New', is_pinned: false, group_id: groupId,
      created_at: 1, updated_at: 1 };
  };
  await f.store.getState().createSession();
  assert.equal(f.store.getState().sessions[0].group_id, 1);
  await f.store.getState().createSession(undefined, null);
  assert.equal(f.store.getState().sessions[0].group_id, null);
  await f.store.getState().createSession(undefined, 2);
  assert.equal(f.store.getState().sessions[0].group_id, 2);
  assert.deepEqual(destinations, [1, null, 2]);
});

test('refresh waits for an in-flight session creation and keeps the real new session', async t => {
  const f = fixture(); t.after(f.close);
  const response = deferred<Awaited<ReturnType<typeof f.api.createSession>>>(); let reads = 0;
  f.api.createSession = () => response.promise;
  f.api.getSessions = async () => { reads += 1; return [...f.store.getState().sessions]; };
  const creation = f.store.getState().createSession();
  const loading = f.store.getState().refreshSessionNavigation();
  await tick(); assert.equal(reads, 0);
  response.resolve({ session_id: 'real', title: 'New', is_pinned: false, group_id: 1, created_at: 1, updated_at: 1 });
  await Promise.all([creation, loading]);
  assert.equal(f.store.getState().sessions[0].id, 'real');
  assert.equal(f.store.getState().currentSessionId, 'real');
});

test('deleting a project only unassigns its conversations; failure leaves the project intact', async t => {
  const f = fixture(); t.after(f.close);
  const before = f.store.getState();
  f.api.deleteSessionGroup = async () => { throw new Error('offline'); };
  assert.equal(await before.deleteSessionGroup(1), false);
  assert.equal(f.store.getState().sessions[0].group_id, 1);
  assert.equal(f.store.getState().sessionGroups.length, 2);
  f.api.deleteSessionGroup = async () => ({ deleted: true });
  assert.equal(await before.deleteSessionGroup(1), true);
  assert.equal(f.store.getState().sessions[0].group_id, null);
  assert.equal(f.store.getState().sessions[0].is_pinned, true);
  assert.equal(f.store.getState().chatHistory, before.chatHistory);
  assert.equal(f.store.getState().currentSessionId, 'A');
});

test('logout discards pending folder updates, skips queued writes and cannot roll back the new account', async t => {
  const f = fixture(); t.after(f.close);
  const response = deferred<ChatSessionGroup>(); let writes = 0;
  f.api.updateSessionGroup = async () => { writes += 1; return response.promise; };
  const old = f.store.getState().updateSessionGroup(1, { name: 'old account' });
  const queued = f.store.getState().updateSessionGroup(2, { name: 'should not send' });
  await tick(); f.store.getState().reset();
  f.store.setState({ sessionGroups: [group(1, { name: 'new account' })] });
  response.resolve(group(1, { name: 'private' }));
  await Promise.all([old, queued]);
  assert.equal(writes, 1);
  assert.equal(f.store.getState().sessionGroups[0].name, 'new account');
  assert.equal(f.store.getState().sessionNavigationPending, 0);
});

test('logout discards late list loads and late group creation', async t => {
  const f = fixture(); t.after(f.close);
  const sessions = deferred<ChatSession[]>(), created = deferred<ChatSessionGroup>();
  f.api.getSessions = () => sessions.promise;
  const loading = f.store.getState().refreshSessionNavigation();
  await tick();
  f.api.createSessionGroup = () => created.promise;
  const creation = f.store.getState().createSessionGroup('private');
  await tick(); f.store.getState().reset();
  sessions.resolve([session('secret', 1)]); created.resolve(group(9));
  await Promise.all([loading, creation]);
  assert.equal(f.store.getState().sessions.length, 0);
  assert.equal(f.store.getState().sessionGroups.length, 0);
  assert.equal(f.store.getState().sessionNavigationLoading, false);
});
