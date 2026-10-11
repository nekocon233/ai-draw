import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FrameEditRecipe,
  applyFramePixelOperation,
  runFrameEditBatch,
  type FrameEditOperation,
  type FramePixelOperation,
  type FramePixels,
  type FrameReplaceOperation,
  type RenderedFrameEdit,
  type WorksetFrameEdits,
} from '../src/utils/frameEditOperations.ts';

const replace = (target: readonly [number, number, number], color: string): FrameReplaceOperation => ({
  type: 'replace', targetColor: target, targetXRatio: 0, targetYRatio: 0,
  replaceWithTransparency: false, replacementColor: color, opacity: 1,
  replaceTolerance: 0, colorReplaceTolerance: 0, replaceMatchMode: 'global',
  replaceEdgeCleanup: 0, replaceEdgeEnhancementMode: 'dilate',
});
const white: FramePixels = { width: 2, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]) };
const fill: FramePixelOperation = { type: 'fill', xRatio: 0, yRatio: 0, color: '#ff0000', opacity: 1, tolerance: 0 };

function replayPixels(operations: readonly FrameEditOperation[], source = white) {
  let pixels = source;
  for (const operation of operations) {
    if (operation.type !== 'fill' && operation.type !== 'replace' && operation.type !== 'soften') throw new Error('unexpected test operation');
    const data = applyFramePixelOperation(pixels, operation);
    if (data) pixels = { ...pixels, data };
  }
  return Array.from(pixels.data);
}

test('replays every replacement in order, including replacements that depend on an earlier fill', () => {
  const first = replace([255, 0, 0], '#00ff00');
  const second = replace([0, 255, 0], '#0000ff');
  assert.deepEqual(replayPixels([fill, first, second]), [0, 0, 255, 255, 0, 0, 255, 255]);
  assert.deepEqual(replayPixels([second, first, fill]), [255, 0, 0, 255, 255, 0, 0, 255]);
  assert.deepEqual(Array.from(white.data), [255, 255, 255, 255, 255, 255, 255, 255], 'source remains available for undo');
});

test('a missing replacement target leaves the frame unchanged and does not prevent later edits', () => {
  assert.equal(applyFramePixelOperation(white, replace([0, 0, 0], '#00ff00')), null);
  assert.deepEqual(replayPixels([replace([0, 0, 0], '#00ff00'), fill]), [255, 0, 0, 255, 255, 0, 0, 255]);
});

test('fill maps the same relative point to differently sized frames and respects disconnected regions', () => {
  const source = { width: 4, height: 1, data: new Uint8ClampedArray([
    255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  ]) };
  const result = applyFramePixelOperation(source, { ...fill, type: 'fill', xRatio: 1, yRatio: 0, color: '#ff0000', opacity: 1, tolerance: 0 });
  assert.deepEqual(Array.from(result!), [255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]);
});

test('fill preserves alpha compositing and softening only changes alpha', () => {
  const source = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 255, 128]) };
  const result = applyFramePixelOperation(source, { type: 'fill', xRatio: 0, yRatio: 0, color: '#ff0000', opacity: 0.5, tolerance: 0 });
  assert.deepEqual(Array.from(result!), [170, 0, 85, 192]);
  const edge = { width: 3, height: 1, data: new Uint8ClampedArray([50, 60, 70, 0, 50, 60, 70, 255, 50, 60, 70, 0]) };
  assert.deepEqual(Array.from(applyFramePixelOperation(edge, { type: 'soften', radius: 1 })!), [50, 60, 70, 85, 50, 60, 70, 85, 50, 60, 70, 85]);
  assert.equal(edge.data[7], 255);
});

test('saving keeps the earlier edits, live parameter changes coalesce, and undo/redo snapshots stay immutable', () => {
  const recipe = new FrameEditRecipe();
  recipe.append(fill);
  recipe.markSaved();
  const saved = recipe.operations;
  recipe.append(replace([255, 0, 0], '#00ff00'));
  const green = recipe.operations;
  recipe.replace(1, replace([255, 0, 0], '#0000ff'));
  const blue = recipe.operations;
  assert.equal(blue.length, 2, 'a live parameter change does not append another operation');
  assert.deepEqual(replayPixels(green), [0, 255, 0, 255, 0, 255, 0, 255]);
  assert.deepEqual(replayPixels(blue), [0, 0, 255, 255, 0, 0, 255, 255]);
  recipe.restore(saved);
  assert.deepEqual(replayPixels(recipe.operations), [255, 0, 0, 255, 255, 0, 0, 255]);
  recipe.restore(blue);
  assert.deepEqual(replayPixels(recipe.operations), [0, 0, 255, 255, 0, 0, 255, 255]);
  recipe.restoreSaved();
  assert.equal(recipe.operations, saved);
  assert.equal(new FrameEditRecipe().operations.length, 0, 'reopening starts a new recipe');
});

test('the full recipe survives trimming bitmap undo history and another save checkpoint', () => {
  const recipe = new FrameEditRecipe();
  recipe.append(fill);
  for (let i = 0; i < 45; i += 1) recipe.append({ type: 'soften', radius: 1 });
  recipe.markSaved();
  recipe.append(replace([255, 0, 0], '#00ff00'));
  assert.equal(recipe.operations.length, 47);
  assert.deepEqual(replayPixels(recipe.operations), [0, 255, 0, 255, 0, 255, 0, 255]);
  recipe.restoreSaved();
  assert.equal(recipe.operations.length, 46);
});

const rendered: RenderedFrameEdit = { image: 'final-current-png', width: 40, height: 20 };
const edits: WorksetFrameEdits = { current: { id: 'current', ...rendered }, operations: [fill, { type: 'upscale', method: 'lanczos', scale: 2 }] };

test('batch saves the current final image once and replays the entire recipe only for other frames', async () => {
  const calls: string[] = [];
  const results = await runFrameEditBatch([{ id: 'first' }, { id: 'current' }, { id: 'last' }], edits, {
    isCurrent: () => true,
    render: async (target, operations) => {
      calls.push(`render:${target.id}`);
      assert.equal(operations, edits.operations);
      return { ...rendered, image: `rendered-${target.id}` };
    },
    save: async (target, result) => {
      calls.push(`save:${target.id}`);
      if (target.id === 'current') assert.equal(result.image, 'final-current-png');
      return `saved-${target.id}`;
    },
  });
  assert.deepEqual(calls, ['render:first', 'save:first', 'save:current', 'render:last', 'save:last']);
  assert.equal(results?.size, 3);
});

test('a failed frame rejects the batch without returning a partial document, and retry starts from the same sources', async () => {
  const targets = [{ id: 'current' }, { id: 'bad' }];
  const original = structuredClone(targets);
  await assert.rejects(runFrameEditBatch(targets, edits, {
    isCurrent: () => true,
    render: async () => { throw new Error('background failed'); },
    save: async () => 'uploaded',
  }), /background failed/);
  assert.deepEqual(targets, original);
  const results = await runFrameEditBatch(targets, edits, {
    isCurrent: () => true, render: async () => rendered, save: async target => target.id,
  });
  assert.equal(results?.size, 2);
});

test('stale render or save responses cannot return results for a changed workspace', async () => {
  let active = true;
  let saves = 0;
  assert.equal(await runFrameEditBatch([{ id: 'other' }], edits, {
    isCurrent: () => active,
    render: async () => { active = false; return rendered; },
    save: async () => { saves += 1; return 'saved'; },
  }), null);
  assert.equal(saves, 0);
  active = true;
  assert.equal(await runFrameEditBatch([{ id: 'current' }], edits, {
    isCurrent: () => active,
    render: async () => rendered,
    save: async () => { active = false; return 'saved'; },
  }), null);
});
