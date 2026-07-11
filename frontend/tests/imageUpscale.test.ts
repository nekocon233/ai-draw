import assert from 'node:assert/strict';
import test from 'node:test';

import { getImageUpscaleTarget } from '../src/utils/imageUpscale.ts';

const limits = { maxEdge: 4096, maxPixels: 16_777_216 };

test('calculates exact 2x and 4x output dimensions', () => {
  assert.deepEqual(getImageUpscaleTarget(800, 600, 2, limits), {
    width: 1600,
    height: 1200,
    allowed: true,
  });
  assert.deepEqual(getImageUpscaleTarget(512, 256, 4, limits), {
    width: 2048,
    height: 1024,
    allowed: true,
  });
});

test('rejects output beyond the longest-edge limit', () => {
  const target = getImageUpscaleTarget(2049, 1000, 2, limits);
  assert.equal(target.allowed, false);
  assert.equal(target.width, 4098);
  assert.match(target.reason ?? '', /4096px/);
});

test('rejects output beyond the total-pixel limit', () => {
  const target = getImageUpscaleTarget(2048, 2049, 2, {
    maxEdge: 8192,
    maxPixels: limits.maxPixels,
  });
  assert.equal(target.allowed, false);
  assert.match(target.reason ?? '', /16,777,216/);
});

test('rejects a safe final size when native model processing would exceed limits', () => {
  const target = getImageUpscaleTarget(2048, 1024, 2, limits, 4);

  assert.equal(target.width, 4096);
  assert.equal(target.height, 2048);
  assert.equal(target.allowed, false);
  assert.match(target.reason ?? '', /内部会生成 8192×4096/);
});
