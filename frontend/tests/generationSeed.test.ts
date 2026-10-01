import assert from 'node:assert/strict';
import test from 'node:test';

import type { WorkflowMetadata, WorkflowParameter } from '../src/types/api.ts';
import {
  alignSeeds, buildMediaSeeds, clearFixedSeeds, getFixedSeed, getMaxBaseSeed, getSeedError, getSeedParameter,
  MAX_SEED, normalizeSeed, randomSeed, readMediaSeed,
} from '../src/utils/generationSeed.ts';

const seedParameter: WorkflowParameter = {
  name: 'qwen_fixed_seed', label: '种子', type: 'seed', min: 0, max: MAX_SEED, default: '',
};

const qwen: WorkflowMetadata = {
  key: 'qwen_image_21_t2i', label: 'Qwen', description: '', requires_image: false,
  parameters: [{ name: 'prompt', label: '提示词', type: 'text', default: '' }, seedParameter],
};

const gpt: WorkflowMetadata = {
  key: 'gpt_image', label: 'GPT Image', description: '', requires_image: false,
  parameters: [{ name: 'prompt', label: '提示词', type: 'text', default: '' }],
};

test('only safe non-negative integers are fixed seeds', () => {
  assert.equal(normalizeSeed(42), 42);
  assert.equal(normalizeSeed(' 7 '), 7);
  assert.equal(normalizeSeed(MAX_SEED), MAX_SEED);
  for (const value of ['', null, undefined, -1, 1.5, MAX_SEED + 1, '1e3', 'x', '-3', true]) {
    assert.equal(normalizeSeed(value), '', String(value));
  }
});

test('the seed parameter comes from workflow metadata', () => {
  assert.equal(getSeedParameter(qwen), seedParameter);
  assert.equal(getSeedParameter(gpt), undefined);
  assert.equal(getSeedParameter(undefined), undefined);
});

test('a batch leaves room for base + count - 1', () => {
  assert.equal(getMaxBaseSeed(seedParameter, 1), MAX_SEED);
  assert.equal(getMaxBaseSeed(seedParameter, 4), MAX_SEED - 3);
  assert.equal(getMaxBaseSeed({ ...seedParameter, max: 10 }, 4), 7);
  assert.equal(getMaxBaseSeed(undefined, 0), MAX_SEED);
});

test('draft seeds are validated against the batch size', () => {
  assert.equal(getSeedError('', seedParameter, 4), null);
  assert.equal(getSeedError(undefined, seedParameter, 4), null);
  assert.equal(getSeedError(0, seedParameter, 4), null);
  assert.equal(getSeedError(MAX_SEED - 3, seedParameter, 4), null);
  assert.equal(getSeedError(null, seedParameter, 1), '请输入种子，或改为随机');
  assert.equal(getSeedError(1.5, seedParameter, 1), '种子必须是非负整数');
  assert.equal(getSeedError(-1, seedParameter, 1), '种子必须是非负整数');
  assert.equal(getSeedError(MAX_SEED - 2, seedParameter, 4), `生成 4 张时种子最大为 ${MAX_SEED - 3}`);
  assert.equal(getSeedError(11, { ...seedParameter, max: 10 }, 1), '种子最大为 10');
});

test('random seeds use the same 32-bit range as the server', () => {
  for (let index = 0; index < 50; index += 1) {
    const seed = randomSeed();
    assert.ok(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32);
  }
});

test('a round shows its fixed seed only when one was sent', () => {
  assert.equal(getFixedSeed(qwen, { qwen_fixed_seed: 123 }), 123);
  assert.equal(getFixedSeed(qwen, { qwen_fixed_seed: '' }), null);
  assert.equal(getFixedSeed(qwen, undefined), null);
  // A seed saved by another workflow family is not this round's seed.
  assert.equal(getFixedSeed(gpt, { qwen_fixed_seed: 123 }), null);
});

test('result seeds are keyed by URL and resent in image order', () => {
  assert.equal(readMediaSeed(5), 5);
  assert.equal(readMediaSeed(null), null);
  assert.equal(readMediaSeed('5'), null);
  assert.equal(readMediaSeed(-1), null);

  const mediaSeeds = buildMediaSeeds(['a.png', 'b.png', 'c.png', { loading: true }], [10, null, 12.5]);
  assert.deepEqual(mediaSeeds, { 'a.png': 10 });
  assert.deepEqual(buildMediaSeeds(['a.png'], undefined), {});
  assert.deepEqual(buildMediaSeeds(undefined, [1]), {});

  // An edited image replaces its URL, so it is saved without the original seed.
  assert.deepEqual(alignSeeds(['edited.png', 'a.png'], mediaSeeds), [null, 10]);
  assert.deepEqual(alignSeeds(['a.png'], undefined), [null]);
});

test('a new session clears fixed seeds without touching other options', () => {
  assert.deepEqual(
    clearFixedSeeds({ qwen_fixed_seed: 5, qwen_steps: '25', h3_fixed_seed: 9 }, [qwen, gpt]),
    { qwen_fixed_seed: '', qwen_steps: '25', h3_fixed_seed: 9 },
  );
});
