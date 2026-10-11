import assert from 'node:assert/strict';
import test from 'node:test';
import {
  centeredFrameCrop, drawFrameCrop, frameCropBounds, frameCropOperation, moveFrameCrop, resizeFrameCrop,
  type CropHandle,
} from '../src/utils/frameGeometry.ts';
import { FrameEditRecipe, transformFramePixels } from '../src/utils/frameEditOperations.ts';

const image = {
  width: 3, height: 2,
  data: new Uint8ClampedArray([
    10, 11, 12, 255, 20, 21, 22, 128, 30, 31, 32, 0,
    40, 41, 42, 64, 50, 51, 52, 255, 60, 61, 62, 200,
  ]),
};
const flip = { type: 'flip-horizontal' as const };

test('horizontal flipping mirrors each row, preserves RGBA, and twice restores the exact input', () => {
  const original = new Uint8ClampedArray(image.data);
  const result = transformFramePixels(image, flip);
  assert.deepEqual(Array.from(result.data), [
    30, 31, 32, 0, 20, 21, 22, 128, 10, 11, 12, 255,
    60, 61, 62, 200, 50, 51, 52, 255, 40, 41, 42, 64,
  ]);
  assert.deepEqual(transformFramePixels(result, flip), image);
  assert.deepEqual(image.data, original);
});

test('cropping copies the selected pixels without resizing or changing the source', () => {
  const operation = frameCropOperation({ x: 1, y: 0, width: 2, height: 2 }, image);
  const result = transformFramePixels(image, operation);
  assert.equal(result.width, 2);
  assert.equal(result.height, 2);
  assert.deepEqual(Array.from(result.data), [20, 21, 22, 128, 30, 31, 32, 0, 50, 51, 52, 255, 60, 61, 62, 200]);
  assert.equal(image.width, 3);
  assert.equal(image.data.length, 24);
});

test('the crop recipe uses dimensions immediately before the operation and remains ordered with flips', () => {
  const crop = frameCropOperation({ x: 0, y: 0, width: 1, height: 2 }, image);
  const flippedCrop = transformFramePixels(transformFramePixels(image, flip), crop);
  const croppedFlip = transformFramePixels(transformFramePixels(image, crop), flip);
  assert.equal(flippedCrop.data[0], 30);
  assert.equal(croppedFlip.data[0], 10);
  assert.deepEqual(frameCropBounds({ width: 9, height: 6 }, crop), { x: 0, y: 0, width: 3, height: 6 });
  const nextCrop = frameCropOperation({ x: 0, y: 1, width: 1, height: 1 }, flippedCrop);
  assert.deepEqual(Array.from(transformFramePixels(flippedCrop, nextCrop).data), [60, 61, 62, 200]);
});

test('pixel bounds round both edges and clamp to at least one pixel, including tiny and out-of-bounds crops', () => {
  const size = { width: 7, height: 5 };
  assert.deepEqual(frameCropBounds(size, { type: 'crop', xRatio: 0.2, yRatio: 0.2, widthRatio: 0.5, heightRatio: 0.5 }), { x: 1, y: 1, width: 4, height: 3 });
  assert.deepEqual(frameCropBounds(size, { type: 'crop', xRatio: 1, yRatio: 1, widthRatio: 0, heightRatio: 0 }), { x: 6, y: 4, width: 1, height: 1 });
  assert.deepEqual(frameCropBounds(size, { type: 'crop', xRatio: -1, yRatio: -1, widthRatio: 3, heightRatio: 3 }), { x: 0, y: 0, ...size });
  assert.deepEqual(frameCropBounds({ width: 1, height: 1 }, { type: 'crop', xRatio: 0, yRatio: 0, widthRatio: 0.1, heightRatio: 0.1 }), { x: 0, y: 0, width: 1, height: 1 });
});

test('ratio presets fit and center within portrait or landscape images', () => {
  for (const size of [{ width: 1200, height: 800 }, { width: 800, height: 1200 }]) {
    for (const aspect of [1, 4 / 3, 3 / 4, 16 / 9, 9 / 16, size.width / size.height]) {
      const rect = centeredFrameCrop(size, aspect);
      assert.ok(Math.abs(rect.width / rect.height - aspect) < 1e-9);
      assert.ok(rect.x >= 0 && rect.y >= 0);
      assert.ok(rect.width <= size.width && rect.height <= size.height);
      assert.ok(Math.abs(rect.x * 2 + rect.width - size.width) < 1e-9);
      assert.ok(Math.abs(rect.y * 2 + rect.height - size.height) < 1e-9);
    }
    assert.deepEqual(centeredFrameCrop(size, null), { x: 0, y: 0, ...size });
  }
});

test('moving and drawing selections clamp within the image and support reverse drags', () => {
  const size = { width: 100, height: 80 };
  const rect = { x: 10, y: 20, width: 30, height: 40 };
  assert.deepEqual(moveFrameCrop(rect, -50, 100, size), { ...rect, x: 0, y: 40 });
  assert.deepEqual(drawFrameCrop({ x: 60, y: 60 }, { x: -20, y: 10 }, size, null), { x: 0, y: 10, width: 60, height: 50 });
  assert.deepEqual(drawFrameCrop({ x: 10, y: 10 }, { x: 100, y: 100 }, size, 2), { x: 10, y: 10, width: 90, height: 45 });
});

test('all eight handles preserve locked ratios and stay bounded through extreme drags', () => {
  const size = { width: 100, height: 80 };
  const rect = { x: 20, y: 20, width: 40, height: 20 };
  for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as CropHandle[]) {
    for (const dx of [-1000, -5, 5, 1000]) {
      for (const dy of [-1000, -5, 5, 1000]) {
        const result = resizeFrameCrop(rect, handle, dx, dy, size, 2);
        assert.ok(result.width >= 1 && result.height >= 1);
        assert.equal(result.width / result.height, 2);
        assert.ok(result.x >= 0 && result.y >= 0);
        assert.ok(result.x + result.width <= size.width && result.y + result.height <= size.height);
      }
    }
  }
  assert.deepEqual(resizeFrameCrop(rect, 'nw', 5, 10, size, null), { x: 25, y: 30, width: 35, height: 10 });
  assert.deepEqual(resizeFrameCrop(rect, 'nw', 10, 0, size, 2), { x: 30, y: 25, width: 30, height: 15 });
  assert.deepEqual(resizeFrameCrop(rect, 'se', 0, -5, size, 2), { x: 20, y: 20, width: 30, height: 15 });
});

test('geometry recipes survive save checkpoints and undo/redo without replaying an undone crop', () => {
  const recipe = new FrameEditRecipe();
  recipe.append(flip);
  recipe.markSaved();
  const beforeCrop = recipe.operations;
  recipe.append(frameCropOperation({ x: 0, y: 0, width: 1, height: 2 }, image));
  const afterCrop = recipe.operations;
  recipe.restore(beforeCrop);
  assert.equal(recipe.operations.length, 1);
  recipe.restore(afterCrop);
  assert.equal(recipe.operations.length, 2);
  recipe.restoreSaved();
  assert.equal(recipe.operations, beforeCrop);
});
