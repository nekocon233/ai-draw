import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_COLOR_REPLACE_TOLERANCE,
  DEFAULT_FILL_TOLERANCE,
  DEFAULT_REPLACE_TOLERANCE,
  DEFAULT_TRANSPARENT_EDGE_ENHANCEMENT,
  DEFAULT_TRANSPARENT_EDGE_ENHANCEMENT_MODE,
  DEFAULT_TRANSPARENT_REPLACE_MATCH_MODE,
  applyConnectedColorReplacement,
  applyHardTransparentReplacement,
  isHardTransparentReplacementTarget,
} from '../src/utils/frameColorReplacement.ts'

test('keeps fill and replacement tolerance defaults independent', () => {
  assert.equal(DEFAULT_FILL_TOLERANCE, 32)
  assert.equal(DEFAULT_COLOR_REPLACE_TOLERANCE, 32)
  assert.equal(DEFAULT_REPLACE_TOLERANCE, 30)
  assert.equal(DEFAULT_TRANSPARENT_REPLACE_MATCH_MODE, 'connected')
  assert.equal(DEFAULT_TRANSPARENT_EDGE_ENHANCEMENT_MODE, 'dilate')
  assert.equal(DEFAULT_TRANSPARENT_EDGE_ENHANCEMENT, 1)
})

test('rejects transparent or invalid replacement targets before history changes', () => {
  const source = new Uint8ClampedArray([
    255, 255, 255, 0,
    255, 255, 255, 255,
  ])

  assert.equal(isHardTransparentReplacementTarget(source, 2, 1, 0, 0), false)
  assert.equal(isHardTransparentReplacementTarget(source, 2, 1, 1, 0), true)
  assert.equal(isHardTransparentReplacementTarget(source, 2, 1, 2, 0), false)
})

test('clears disconnected pixels that match the clicked color', () => {
  const source = new Uint8ClampedArray([
    255, 255, 255, 255, 0, 0, 0, 255,
    0, 0, 0, 255, 255, 255, 255, 255,
  ])

  assert.deepEqual(
    [...applyHardTransparentReplacement(source, 2, 2, 0, 0, 0, 0)!],
    [0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 0],
  )
})

test('can keep the selected target color across different frame pixels', () => {
  const source = new Uint8ClampedArray([
    102, 100, 100, 255,
    100, 100, 100, 255,
    180, 180, 180, 255,
  ])

  const result = applyHardTransparentReplacement(
    source,
    3,
    1,
    0,
    0,
    1,
    0,
    'global',
    'connected_color',
    [100, 100, 100],
  )

  assert.deepEqual(Array.from(result ?? []), [
    0, 0, 0, 0,
    0, 0, 0, 0,
    180, 180, 180, 255,
  ])
})

test('matches FramePacker RGB Euclidean tolerance scaling', () => {
  const source = new Uint8ClampedArray([
    251, 251, 251, 255,
    113, 109, 108, 128,
    111, 109, 109, 77,
  ])

  assert.deepEqual(
    [...applyHardTransparentReplacement(source, 3, 1, 0, 0, 48, 0)!],
    [0, 0, 0, 0, 0, 0, 0, 0, 111, 109, 109, 77],
  )
})

test('includes pixels exactly on the scaled Euclidean threshold', () => {
  const source = new Uint8ClampedArray([
    251, 251, 251, 255,
    200, 251, 251, 255,
    199, 251, 251, 255,
  ])

  assert.deepEqual(
    [...applyHardTransparentReplacement(source, 3, 1, 0, 0, 10, 0)!],
    [0, 0, 0, 0, 0, 0, 0, 0, 199, 251, 251, 255],
  )
})

test('edge enhancement zero preserves unmatched RGBA bytes', () => {
  const source = new Uint8ClampedArray([
    255, 255, 255, 255,
    254, 253, 252, 123,
  ])

  const result = applyHardTransparentReplacement(source, 2, 1, 0, 0, 0, 0)

  assert.deepEqual([...result!], [0, 0, 0, 0, 254, 253, 252, 123])
  assert.notStrictEqual(result, source)
  assert.deepEqual([...source], [255, 255, 255, 255, 254, 253, 252, 123])
})

test('edge enhancement grows through four-connected color candidates', () => {
  const source = new Uint8ClampedArray([
    251, 251, 251, 255,
    246, 251, 251, 255,
    246, 251, 251, 255,
    246, 251, 251, 255,
    0, 0, 0, 255,
  ])

  assert.deepEqual(
    [...applyHardTransparentReplacement(source, 5, 1, 0, 0, 0, 1)!],
    [...new Array(16).fill(0), 0, 0, 0, 255],
  )
})

test('edge enhancement does not cross diagonal-only connections', () => {
  const source = new Uint8ClampedArray([
    251, 251, 251, 255, 0, 0, 0, 255,
    0, 0, 0, 255, 246, 251, 251, 255,
  ])

  assert.deepEqual(
    [...applyHardTransparentReplacement(source, 2, 2, 0, 0, 0, 1)!],
    [0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 255, 246, 251, 251, 255],
  )
})

test('global color enhancement clears disconnected candidates', () => {
  const source = new Uint8ClampedArray([
    251, 251, 251, 255,
    0, 0, 0, 255,
    246, 251, 251, 255,
  ])

  assert.deepEqual(
    [...applyHardTransparentReplacement(source, 3, 1, 0, 0, 0, 1, 'global', 'global_color')!],
    [0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0],
  )
})

test('hard dilation enhancement clears neighboring pixels regardless of color', () => {
  const source = new Uint8ClampedArray([
    251, 251, 251, 255,
    0, 0, 0, 255,
    0, 0, 0, 255,
  ])

  assert.deepEqual(
    [...applyHardTransparentReplacement(source, 3, 1, 0, 0, 0, 1, 'global', 'dilate')!],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255],
  )
})

test('hard dilation enhancement includes diagonal neighbors', () => {
  const source = new Uint8ClampedArray([
    0, 0, 0, 255, 0, 0, 0, 255,
    0, 0, 0, 255, 251, 251, 251, 255,
  ])

  assert.deepEqual(
    [...applyHardTransparentReplacement(source, 2, 2, 1, 1, 0, 1, 'global', 'dilate')!],
    new Array(16).fill(0),
  )
})

test('hard dilation enhancement expands by the selected pixel radius', () => {
  const source = new Uint8ClampedArray([
    251, 251, 251, 255,
    0, 0, 0, 255,
    0, 0, 0, 255,
    0, 0, 0, 255,
  ])

  assert.deepEqual(
    [...applyHardTransparentReplacement(source, 4, 1, 0, 0, 0, 2, 'global', 'dilate')!],
    [...new Array(12).fill(0), 0, 0, 0, 255],
  )
})

test('connected mode preserves disconnected exact color matches', () => {
  const source = new Uint8ClampedArray([
    251, 251, 251, 255, 0, 0, 0, 255,
    0, 0, 0, 255, 251, 251, 251, 255,
  ])

  assert.deepEqual(
    [...applyHardTransparentReplacement(source, 2, 2, 0, 0, 0, 0, 'connected')!],
    [0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 255, 251, 251, 251, 255],
  )
})

test('connected mode keeps comparing gradual colors to the clicked reference', () => {
  const source = new Uint8ClampedArray([
    251, 251, 251, 255,
    246, 251, 251, 255,
    241, 251, 251, 255,
    236, 251, 251, 255,
  ])

  assert.deepEqual(
    [...applyHardTransparentReplacement(source, 4, 1, 0, 0, 1, 0, 'connected')!],
    [0, 0, 0, 0, 0, 0, 0, 0, 241, 251, 251, 255, 236, 251, 251, 255],
  )
})

test('continuous mode follows gradual color changes', () => {
  const source = new Uint8ClampedArray([
    251, 251, 251, 255,
    246, 251, 251, 255,
    241, 251, 251, 255,
    236, 251, 251, 255,
  ])

  assert.deepEqual(
    [...applyHardTransparentReplacement(source, 4, 1, 0, 0, 1, 0, 'continuous')!],
    new Array(16).fill(0),
  )
})

test('rounds tolerance and edge enhancement before clamping them', () => {
  const source = new Uint8ClampedArray([
    251, 251, 251, 255,
    3, 251, 251, 255,
    113, 109, 108, 255,
  ])

  assert.deepEqual(
    [...applyHardTransparentReplacement(source, 3, 1, 0, 0, 47.6, 0.5)!],
    new Array(12).fill(0),
  )
})

test('clamps connected color enhancement above fifty levels', () => {
  const source = new Uint8ClampedArray([
    251, 251, 251, 255,
    0, 251, 251, 255,
    0, 0, 251, 255,
  ])

  assert.deepEqual(
    [...applyHardTransparentReplacement(source, 3, 1, 0, 0, 0, 100)!],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 251, 255],
  )
})

test('normalizes non-finite tolerance and edge enhancement to zero', () => {
  const source = new Uint8ClampedArray([
    255, 255, 255, 255,
    0, 0, 0, 255,
  ])

  assert.deepEqual(
    [...applyHardTransparentReplacement(source, 2, 1, 0, 0, Number.NaN, Number.NaN)!],
    [0, 0, 0, 0, 0, 0, 0, 255],
  )
})

test('does not select fully transparent matching pixels', () => {
  const source = new Uint8ClampedArray([
    25, 50, 75, 255,
    25, 50, 75, 0,
  ])

  assert.deepEqual(
    [...applyHardTransparentReplacement(source, 2, 1, 0, 0, 0, 0)!],
    [0, 0, 0, 0, 25, 50, 75, 0],
  )
})

test('returns null when the clicked pixel is fully transparent', () => {
  const source = new Uint8ClampedArray([25, 50, 75, 0])

  assert.equal(applyHardTransparentReplacement(source, 1, 1, 0, 0, 0, 0), null)
})

test('returns null for invalid dimensions, coordinates, or source length', () => {
  const source = new Uint8ClampedArray([0, 0, 0, 255])

  assert.equal(applyHardTransparentReplacement(source, 0, 1, 0, 0, 0, 0), null)
  assert.equal(applyHardTransparentReplacement(source, 1.5, 1, 0, 0, 0, 0), null)
  assert.equal(applyHardTransparentReplacement(source, 1, 1, -1, 0, 0, 0), null)
  assert.equal(applyHardTransparentReplacement(source, 1, 1, 0.5, 0, 0, 0), null)
  assert.equal(applyHardTransparentReplacement(source, 1, 1, 1, 0, 0, 0), null)
  assert.equal(
    applyHardTransparentReplacement(new Uint8ClampedArray(3), 1, 1, 0, 0, 0, 0),
    null,
  )
})

test('recolors an opaque subject surrounded by transparent pixels', () => {
  const source = new Uint8ClampedArray([
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 100, 110, 120, 255, 101, 111, 121, 128,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ])

  const result = applyConnectedColorReplacement(
    source,
    3,
    3,
    1,
    1,
    [100, 110, 120],
    [200, 20, 30],
    2,
    0.5,
  )

  assert.deepEqual(Array.from(result ?? []), [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 200, 20, 30, 128, 200, 20, 30, 64,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ])
})

test('connected recoloring preserves disconnected matches', () => {
  const source = new Uint8ClampedArray([
    10, 20, 30, 255,
    255, 255, 255, 255,
    10, 20, 30, 255,
  ])

  const result = applyConnectedColorReplacement(
    source,
    3,
    1,
    0,
    0,
    [10, 20, 30],
    [1, 2, 3],
    0,
    1,
  )

  assert.deepEqual(Array.from(result ?? []), [
    1, 2, 3, 255,
    255, 255, 255, 255,
    10, 20, 30, 255,
  ])
})
