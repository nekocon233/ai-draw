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

test('drafts keep the original description and result per session', () => {
  const storage = memoryStorage();
  writeExpansionDraft('session-a', '头发飘动', '头发随动作细微飘动。', storage, 1);
  writeExpansionDraft('session-b', '挥手', '', storage, 2);
  assert.deepEqual(readExpansionDraft('session-a', storage), { source: '头发飘动', result: '头发随动作细微飘动。', updatedAt: 1 });
  assert.deepEqual(readExpansionDraft('session-b', storage), { source: '挥手', result: '', updatedAt: 2 });
  assert.equal(readExpansionDraft('missing', storage), null);
});

test('empty drafts are removed and only recent sessions are kept', () => {
  const storage = memoryStorage();
  writeExpansionDraft('session-a', '头发飘动', '', storage, 1);
  writeExpansionDraft('session-a', '  ', '', storage, 2);
  assert.equal(readExpansionDraft('session-a', storage), null);
  assert.equal(storage.values.has(PROMPT_EXPANSION_DRAFTS_KEY), false);

  for (let index = 0; index <= MAX_PROMPT_EXPANSION_DRAFTS; index++) {
    writeExpansionDraft(`session-${index}`, `描述 ${index}`, '', storage, index);
  }
  assert.equal(readExpansionDraft('session-0', storage), null);
  assert.equal(readExpansionDraft(`session-${MAX_PROMPT_EXPANSION_DRAFTS}`, storage)?.source, `描述 ${MAX_PROMPT_EXPANSION_DRAFTS}`);
  assert.equal(Object.keys(JSON.parse(storage.values.get(PROMPT_EXPANSION_DRAFTS_KEY)!)).length, MAX_PROMPT_EXPANSION_DRAFTS);
});

test('corrupt storage is ignored and logout clears every draft', () => {
  const storage = memoryStorage();
  storage.setItem(PROMPT_EXPANSION_DRAFTS_KEY, '{broken');
  assert.equal(readExpansionDraft('session-a', storage), null);
  storage.setItem(PROMPT_EXPANSION_DRAFTS_KEY, JSON.stringify({ 'session-a': { source: 1 }, 'session-b': { source: '保留', result: '', updatedAt: 3 } }));
  assert.equal(readExpansionDraft('session-a', storage), null);
  assert.equal(readExpansionDraft('session-b', storage)?.source, '保留');
  clearExpansionDrafts(storage);
  assert.equal(storage.values.size, 0);
});
