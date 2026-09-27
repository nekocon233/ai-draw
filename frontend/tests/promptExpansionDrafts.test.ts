import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearExpansionDrafts,
  MAX_PROMPT_EXPANSION_DRAFTS,
  PROMPT_EXPANSION_DRAFTS_KEY,
  readExpansionDraft,
  writeExpansionDraft,
} from '../src/utils/promptExpansionDrafts.ts';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test('drafts keep the original description and result per session and input type', () => {
  const storage = memoryStorage();
  writeExpansionDraft('session-a', 'video', '头发飘动', '头发随动作细微飘动。', storage, 1);
  writeExpansionDraft('session-a', 'image', '红色外套', '', storage, 2);
  writeExpansionDraft('session-b', 'video', '挥手', '', storage, 3);
  assert.deepEqual(readExpansionDraft('session-a', 'video', storage), { source: '头发飘动', result: '头发随动作细微飘动。', updatedAt: 1 });
  assert.deepEqual(readExpansionDraft('session-a', 'image', storage), { source: '红色外套', result: '', updatedAt: 2 });
  assert.deepEqual(readExpansionDraft('session-b', 'video', storage), { source: '挥手', result: '', updatedAt: 3 });
  assert.equal(readExpansionDraft('session-b', 'image', storage), null);
  assert.equal(readExpansionDraft('missing', 'image', storage), null);
});

test('empty drafts are removed and only recent drafts are kept', () => {
  const storage = memoryStorage();
  writeExpansionDraft('session-a', 'image', '头发飘动', '', storage, 1);
  writeExpansionDraft('session-a', 'image', '  ', '', storage, 2);
  assert.equal(readExpansionDraft('session-a', 'image', storage), null);
  assert.equal(storage.values.has(PROMPT_EXPANSION_DRAFTS_KEY), false);

  for (let index = 0; index <= MAX_PROMPT_EXPANSION_DRAFTS; index++) {
    writeExpansionDraft(`session-${index}`, 'image', `描述 ${index}`, '', storage, index);
  }
  assert.equal(readExpansionDraft('session-0', 'image', storage), null);
  assert.equal(readExpansionDraft(`session-${MAX_PROMPT_EXPANSION_DRAFTS}`, 'image', storage)?.source, `描述 ${MAX_PROMPT_EXPANSION_DRAFTS}`);
  assert.equal(Object.keys(JSON.parse(storage.values.get(PROMPT_EXPANSION_DRAFTS_KEY)!)).length, MAX_PROMPT_EXPANSION_DRAFTS);
});

test('a draft saved per session by the previous version moves to the other input type on first write', () => {
  const storage = memoryStorage();
  const legacy = { source: '旧描述', result: '旧结果', updatedAt: 1 };
  storage.setItem(PROMPT_EXPANSION_DRAFTS_KEY, JSON.stringify({ 'session-a': legacy }));
  assert.deepEqual(readExpansionDraft('session-a', 'image', storage), legacy);
  assert.deepEqual(readExpansionDraft('session-a', 'video', storage), legacy);

  writeExpansionDraft('session-a', 'image', '', '', storage, 2);
  assert.equal(readExpansionDraft('session-a', 'image', storage), null);
  assert.deepEqual(readExpansionDraft('session-a', 'video', storage), legacy);
  assert.deepEqual(Object.keys(JSON.parse(storage.values.get(PROMPT_EXPANSION_DRAFTS_KEY)!)), ['session-a:video']);
});

test('corrupt storage is ignored and logout clears every draft', () => {
  const storage = memoryStorage();
  storage.setItem(PROMPT_EXPANSION_DRAFTS_KEY, '{broken');
  assert.equal(readExpansionDraft('session-a', 'image', storage), null);
  storage.setItem(PROMPT_EXPANSION_DRAFTS_KEY, JSON.stringify({ 'session-a:image': { source: 1 }, 'session-b:video': { source: '保留', result: '', updatedAt: 3 } }));
  assert.equal(readExpansionDraft('session-a', 'image', storage), null);
  assert.equal(readExpansionDraft('session-b', 'video', storage)?.source, '保留');
  clearExpansionDrafts(storage);
  assert.equal(storage.values.size, 0);
});
