import assert from 'node:assert/strict';
import test from 'node:test';

import type { PromptPreset, SessionOutlineRound } from '../src/types/api.ts';
import type { ChatMessage } from '../src/types/models.ts';
import { isVideoUrl } from '../src/utils/media.ts';
import { buildNavigatorRounds, loadUntilFound, type LocateOptions } from '../src/utils/roundNavigator.ts';

const user = (id: string, timestamp: number, content = '', params?: ChatMessage['params']): ChatMessage => ({
  id, session_id: 'session-a', type: 'user', content, timestamp, params,
});

const reply = (id: string, timestamp: number, images: ChatMessage['images'] = []): ChatMessage => ({
  id: `${id}-reply`, session_id: 'session-a', type: 'assistant', content: '', images, timestamp,
});

const outlineRound = (id: string, timestamp: number, extra: Partial<SessionOutlineRound> = {}): SessionOutlineRound => ({
  id, timestamp, content: `第 ${id} 轮`, media: [], media_count: 0, ...extra,
});

test('loaded rounds pair each prompt with its own reply and preview only finished media', () => {
  const preset = { id: 'sketch_finish', title: '参考图成品化' } as PromptPreset;
  const history = [
    user('a', 1, '画一只猫', { workflow: 'qwen_image_21_t2i', promptPreset: preset }),
    reply('a', 2, ['/uploads/generated/1/a.png', '/uploads/video/1/b.mp4', '/uploads/c.png', '/uploads/d.webm', '/uploads/e.png']),
    user('b', 3),
    reply('b', 4, ['/uploads/generated/1/x.png', { loading: true }]),
    user('c', 5, '还在排队'),
  ];

  const rounds = buildNavigatorRounds(history, null, null);

  assert.deepEqual(rounds.map(round => round.id), ['a', 'b', 'c']);
  assert.ok(rounds.every(round => round.loaded));
  const [first, second, third] = rounds;
  assert.equal(first.text, '画一只猫');
  assert.equal(first.presetTitle, '参考图成品化');
  assert.equal(first.workflow, 'qwen_image_21_t2i');
  assert.equal(first.mediaCount, 5);
  assert.deepEqual(first.media.map(item => [item.url, item.video]), [
    ['/uploads/generated/1/a.png', false],
    ['/uploads/video/1/b.mp4', true],
    ['/uploads/c.png', false],
    ['/uploads/d.webm', true],
  ]);
  assert.equal(first.generating, false);
  assert.equal(second.generating, true, 'a loading placeholder means the round is still generating');
  assert.deepEqual(second.media.map(item => item.url), ['/uploads/generated/1/x.png']);
  assert.equal(third.generating, false);
  assert.equal(buildNavigatorRounds(history, null, 'c-reply')[2].generating, true);
});

test('earlier rounds come from the outline until their page is loaded', () => {
  // The loaded page starts with an orphan reply: its prompt is still on the previous page.
  const history = [reply('c', 31, ['/uploads/c.png']), user('d', 40, '最新一轮'), reply('d', 41)];
  const outline = [
    outlineRound('a', 10, { media: ['/uploads/a.png', '/uploads/video/a.mp4'], media_count: 6, preset_title: '参考镜头动作', workflow: 'minimax_h3_ref' }),
    outlineRound('b', 20),
    outlineRound('c', 30),
    outlineRound('d', 40),
  ];

  const rounds = buildNavigatorRounds(history, outline, null);

  assert.deepEqual(rounds.map(round => [round.id, round.loaded]), [['a', false], ['b', false], ['c', false], ['d', true]]);
  assert.equal(rounds[3].text, '最新一轮', 'loaded rounds use the live history, not the outline');
  assert.deepEqual(rounds[0].media, [
    { url: '/uploads/a.png', video: false },
    { url: '/uploads/video/a.mp4', video: true },
  ]);
  assert.equal(rounds[0].mediaCount, 6);
  assert.equal(rounds[0].presetTitle, '参考镜头动作');
  assert.equal(rounds[0].workflow, 'minimax_h3_ref');
  assert.equal(rounds[0].generating, false);
});

test('outline rounds newer than the loaded history are ignored', () => {
  // "b" was deleted in this tab after the outline was fetched; "e" is fresher than the outline.
  const history = [user('c', 30, 'c'), reply('c', 31), user('e', 50, 'e')];
  const outline = [outlineRound('a', 10), outlineRound('b', 35), outlineRound('c', 30)];

  assert.deepEqual(buildNavigatorRounds(history, outline, null).map(round => round.id), ['a', 'c', 'e']);
  assert.deepEqual(buildNavigatorRounds([], outline, null), []);
  assert.deepEqual(buildNavigatorRounds(history, [], null).map(round => round.id), ['c', 'e']);
});

function locate(overrides: Partial<LocateOptions> & { rendered?: () => boolean }) {
  const calls: string[] = [];
  let pages = 0;
  const options: LocateOptions = {
    find: () => false,
    hasMore: () => true,
    load: async () => {
      pages += 1;
      calls.push(`load ${pages}`);
      return 'loaded';
    },
    alive: () => true,
    settle: async () => {
      calls.push('settle');
    },
    ...overrides,
  };
  return { calls, result: loadUntilFound(options), pages: () => pages };
}

test('loadUntilFound loads earlier pages until the round is rendered', async () => {
  let rendered = 0;
  const run = locate({
    find: () => rendered >= 2,
    settle: async () => {
      rendered += 1;
    },
  });
  assert.equal(await run.result, 'found');
  assert.equal(run.pages(), 2);

  const immediate = locate({ find: () => true });
  assert.equal(await immediate.result, 'found');
  assert.deepEqual(immediate.calls, [], 'a round already on the page needs no request');
});

test('loadUntilFound reports a missing round when history or the page budget runs out', async () => {
  let more = 2;
  const exhausted = locate({ hasMore: () => more-- > 0 });
  assert.equal(await exhausted.result, 'missing');
  assert.equal(exhausted.pages(), 2);

  const capped = locate({ maxPages: 3 });
  assert.equal(await capped.result, 'missing');
  assert.equal(capped.pages(), 3);
});

test('loadUntilFound stops on failures, session switches and newer navigation', async () => {
  assert.equal(await locate({ load: async () => 'error' }).result, 'error');
  assert.equal(await locate({ load: async () => 'stale' }).result, 'cancelled');

  let alive = true;
  const superseded = locate({
    alive: () => alive,
    load: async () => {
      alive = false;
      return 'loaded';
    },
  });
  assert.equal(await superseded.result, 'cancelled');
  assert.deepEqual(superseded.calls, [], 'no settle or further page after the jump was superseded');
  assert.equal(await locate({ alive: () => false }).result, 'cancelled');
});

test('isVideoUrl recognises stored, legacy and inline videos', () => {
  for (const url of ['/uploads/video/1/a.png', '/uploads/generated/1/a.MP4', 'b.webm', 'data:video/mp4;base64,AAAA']) {
    assert.equal(isVideoUrl(url), true, url);
  }
  for (const url of ['/uploads/generated/1/a.png', 'data:image/png;base64,AAAA', '/uploads/spritesheet/1/a.png']) {
    assert.equal(isVideoUrl(url), false, url);
  }
});
