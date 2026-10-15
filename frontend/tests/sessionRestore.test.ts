import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import type { AppState } from '../src/stores/appStore.ts';
import type { apiService } from '../src/api/services.ts';
import { SessionSaveQueue } from '../src/utils/sessionSaveQueue.ts';

// Exercise the real store with isolated browser storage and stubbed transport.
// Vite already provides esbuild; no browser or live API is needed by npm test.
const bundle = buildSync({
  stdin: {
    contents: 'import {useAppStore} from "./src/stores/appStore.ts"; import {apiService} from "./src/api/services.ts"; globalThis.qa={store:useAppStore,api:apiService};',
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
  },
  bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent',
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"DEV":false,"PROD":true}' },
}).outputFiles[0].text;

const workflow = { key: 'qwen_image_21_t2i', label: 'Qwen', description: '', category: '生图', output_type: 'image', requires_image: false, parameters: [
  { name: 'prompt', label: '描述', type: 'text', default: '' },
  { name: 'count', label: '数量', type: 'number', default: 1, max: 16 },
  { name: 'width', label: '宽度', type: 'number', default: 1024 },
  { name: 'height', label: '高度', type: 'number', default: 1024 },
] };
const config = (prompt: string) => ({
  workflow: workflow.key, prompt, lora_prompt: '', strength: 1, count: 16, images_per_row: 4,
  reference_image: null, reference_images: [], input_drafts: null,
  prompt_preset: null, prompt_preset_choices: { [workflow.key]: null }, width: 512, height: 768,
  use_original_size: false, workflow_options: {},
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

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
  const writes: Array<{ sessionId: string; prompt?: string }> = [];
  api.updateSessionConfig = async (sessionId, value) => { writes.push({ sessionId, prompt: value.prompt }); return { message: 'saved' }; };
  api.updateUserConfig = async () => ({ message: 'saved' });
  api.getSessionConfig = async id => config(`saved-${id}`);
  api.getChatHistory = async () => ({ messages: [], has_more: false });
  api.getSessionGroups = async () => [];
  store.setState({ currentSessionId: 'A', composerSessionId: 'A', sessionConfigStatus: 'ready',
    currentWorkflow: workflow.key, availableWorkflows: [workflow], prompt: 'draft-A',
    promptPresetChoices: { [workflow.key]: null }, chatHistory: [], referenceImages: [], inputDrafts: {},
  });
  return { store, api, writes, close: () => store.getState().reset() };
}

test('A → loading B → C never saves A inputs into B, and a late B response cannot replace C', async t => {
  const f = fixture(); t.after(f.close);
  const b = deferred<ReturnType<typeof config>>(), c = deferred<ReturnType<typeof config>>();
  f.api.getSessionConfig = id => id === 'B' ? b.promise : c.promise;
  const toB = f.store.getState().switchSession('B'); await tick();
  assert.equal(f.store.getState().composerSessionId, null);
  const toC = f.store.getState().switchSession('C'); await tick();
  c.resolve(config('saved-C')); await toC;
  b.resolve(config('saved-B')); await toB;
  assert.deepEqual(f.writes, [{ sessionId: 'A', prompt: 'draft-A' }]);
  assert.equal(f.store.getState().prompt, 'saved-C');
  assert.equal(f.store.getState().composerSessionId, 'C');
});

test('returning to A waits for its queued save before fetching the saved draft', async t => {
  const f = fixture(); t.after(f.close);
  const release = deferred<void>(); const reads: string[] = [];
  let persisted = 'old-A';
  f.api.updateSessionConfig = async (id, value) => {
    if (id === 'A') { await release.promise; persisted = value.prompt!; }
    return { message: 'saved' };
  };
  f.api.getSessionConfig = async id => { reads.push(id); return config(id === 'A' ? persisted : 'saved-B'); };
  await f.store.getState().switchSession('B');
  const toA = f.store.getState().switchSession('A'); await tick();
  assert.deepEqual(reads, ['B']);
  release.resolve(); await toA;
  assert.equal(f.store.getState().prompt, 'draft-A');
  assert.deepEqual(reads, ['B', 'A']);
});

test('failed loads cannot be saved as blanks and retry restores references, options and draft groups', async t => {
  const f = fixture(); t.after(f.close);
  f.api.getSessionConfig = async () => { throw new Error('offline'); };
  await f.store.getState().switchSession('B');
  assert.equal(f.store.getState().sessionConfigStatus, 'error');
  assert.equal(await f.store.getState().saveSessionConfig(true), false);
  assert.ok(f.writes.every(write => write.sessionId !== 'B'));
  f.api.getSessionConfig = async () => ({ ...config('saved-B'), reference_images: ['one', null, 'three'],
    workflow_options: { qwen_fixed_seed: 123 }, input_drafts: {
      video: { prompt: 'video draft', reference_images: ['character'], reference_image_end: null, motion_reference_images: ['pose'], motion_reference_video: null, motion_prompt: null, parked_images: [], parked_end_image: null },
    },
  });
  await f.store.getState().loadSessionConfig('B');
  assert.equal(f.store.getState().sessionConfigStatus, 'ready');
  assert.equal(f.store.getState().prompt, 'saved-B');
  assert.equal(f.store.getState().count, 16);
  assert.equal(f.store.getState().width, 512);
  assert.equal(f.store.getState().selectOptions.qwen_fixed_seed, 123);
  assert.equal(f.store.getState().referenceImages[2], 'three');
  assert.equal(f.store.getState().inputDrafts.video?.prompt, 'video draft');
});

test('explicit empty inputs and cancelled presets remain empty after restore', async t => {
  const f = fixture(); t.after(f.close);
  f.api.getSessionConfig = async () => config('');
  await f.store.getState().switchSession('B');
  assert.equal(f.store.getState().prompt, '');
  assert.equal(f.store.getState().referenceImages.length, 0);
  assert.equal(f.store.getState().promptPresetChoices[workflow.key], null);
});

test('failed saves retain a draft for switching back and a retry clears its save error', async t => {
  const f = fixture(); t.after(f.close);
  let fail = true;
  f.api.updateSessionConfig = async id => {
    if (id === 'A' && fail) throw new Error('offline');
    return { message: 'saved' };
  };
  await f.store.getState().switchSession('B');
  await f.store.getState().switchSession('A');
  assert.equal(f.store.getState().prompt, 'draft-A');
  assert.equal(f.store.getState().sessionConfigStatus, 'ready');
  assert.ok(f.store.getState().sessionConfigSaveError);
  fail = false;
  assert.equal(await f.store.getState().saveSessionConfig(true), true);
  assert.equal(f.store.getState().sessionConfigSaveError, null);
});

test('logout invalidates late loads and cancels queued saves', async t => {
  const f = fixture(); t.after(f.close);
  const load = deferred<ReturnType<typeof config>>();
  f.api.getSessionConfig = () => load.promise;
  const switching = f.store.getState().switchSession('B'); await tick();
  f.store.getState().reset();
  load.resolve(config('private-B')); await switching;
  assert.equal(f.store.getState().currentSessionId, null);
  assert.equal(f.store.getState().composerSessionId, null);
  assert.equal(f.store.getState().prompt, '');
  assert.equal(f.store.getState().sessionConfigStatus, 'idle');
});

test('late global defaults cannot overwrite a session that was opened meanwhile', async t => {
  const f = fixture(); t.after(f.close);
  f.store.getState().reset();
  const user = deferred<Awaited<ReturnType<typeof f.api.getUserConfig>>>();
  f.api.getUserConfig = () => user.promise;
  const defaults = f.store.getState().loadUserConfig();
  await f.store.getState().switchSession('B');
  user.resolve({ current_workflow: workflow.key, prompt: 'global default', lora_prompt: '', strength: 1, count: 1, images_per_row: 4, updated_at: '' });
  await defaults;
  assert.equal(f.store.getState().prompt, 'saved-B');
});

test('new sessions start with owned defaults instead of the previous session input', async t => {
  const f = fixture(); t.after(f.close);
  f.api.createSession = async () => ({ session_id: 'new', title: 'New', is_pinned: false, created_at: 1, updated_at: 1 });
  await f.store.getState().createSession();
  assert.equal(f.store.getState().composerSessionId, 'new');
  assert.equal(f.store.getState().sessionConfigStatus, 'ready');
  assert.equal(f.store.getState().prompt, '');
  assert.equal(f.store.getState().width, 1024);
  assert.ok(f.writes.filter(write => write.sessionId === 'new').every(write => write.prompt === ''));
});

test('a new-session response cannot take over a session selected during creation', async t => {
  const f = fixture(); t.after(f.close);
  const created = deferred<Awaited<ReturnType<typeof f.api.createSession>>>();
  f.api.createSession = () => created.promise;
  const creating = f.store.getState().createSession();
  await f.store.getState().switchSession('B');
  created.resolve({ session_id: 'new', title: 'New', is_pinned: false, created_at: 1, updated_at: 1 });
  await creating;
  assert.equal(f.store.getState().currentSessionId, 'B');
  assert.equal(f.store.getState().composerSessionId, 'B');
  assert.equal(f.store.getState().prompt, 'saved-B');
});

test('startup with no history unlocks a blank composer, and a failed list can be retried', async t => {
  const f = fixture(); t.after(f.close);
  f.store.getState().reset();
  f.api.getSessions = async () => { throw new Error('offline'); };
  await f.store.getState().loadSessions();
  assert.equal(f.store.getState().sessionConfigStatus, 'error');
  assert.equal(await f.store.getState().addChatMessage({ prompt: 'blocked', workflow: workflow.key, strength: undefined, count: 1 }), null);
  f.api.getSessions = async () => [];
  f.api.getUserConfig = async () => ({ current_workflow: workflow.key, prompt: '', lora_prompt: '', strength: 1, count: 1, images_per_row: 4, updated_at: '' });
  await f.store.getState().loadSessions();
  assert.equal(f.store.getState().sessionConfigStatus, 'idle');
  assert.equal(f.store.getState().currentSessionId, null);
  assert.equal(f.store.getState().prompt, '');
});

test('logout prevents late creation from writing configuration with a new account', async t => {
  const f = fixture(); t.after(f.close);
  const created = deferred<Awaited<ReturnType<typeof f.api.createSession>>>();
  f.api.createSession = () => created.promise;
  const creating = f.store.getState().createSession();
  f.store.getState().reset();
  created.resolve({ session_id: 'new', title: 'New', is_pinned: false, created_at: 1, updated_at: 1 });
  await creating;
  assert.equal(f.store.getState().currentSessionId, null);
  assert.ok(f.writes.every(write => write.sessionId !== 'new'));
});

test('save queues serialize versions and preserve other sessions when one draft is debounced', async () => {
  const release = deferred<void>(); const writes: string[] = [];
  const queue = new SessionSaveQueue<string>(async (id, value) => {
    if (value === 'first') await release.promise;
    writes.push(id + ':' + value);
  });
  const first = queue.save('A', 'first', true);
  const second = queue.save('A', 'last');
  const other = queue.save('B', 'other', true);
  const flushed = queue.flush('A');
  await other;
  assert.deepEqual(writes, ['B:other']);
  release.resolve(); await Promise.all([first, second, flushed]);
  assert.deepEqual(writes, ['B:other', 'A:first', 'A:last']);
  queue.clear();
});

test('clearing a queued draft settles its save promise without sending it', async () => {
  const writes: string[] = [];
  const queue = new SessionSaveQueue<string>(async (_id, value) => { writes.push(value); });
  const saved = queue.save('A', 'private draft');
  queue.clear();
  assert.equal(await saved, false);
  assert.equal(await queue.flush('A'), true);
  assert.deepEqual(writes, []);
});
