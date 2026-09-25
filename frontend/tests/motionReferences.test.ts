import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getMotionReferenceError, moveMotionReference } from '../src/utils/motionReferences.ts';

test('requires appearance plus one to eight ordered pose references', () => {
  assert.ok(getMotionReferenceError(null, ['pose']));
  assert.ok(getMotionReferenceError('character', []));
  assert.equal(getMotionReferenceError('character', Array(8).fill('pose')), null);
  assert.ok(getMotionReferenceError('character', Array(9).fill('pose')));
  assert.ok(getMotionReferenceError('character', [' ']));
});

test('reordering preserves the previous generation snapshot and repeated poses', () => {
  const snapshot = ['rest', 'swing', 'rest'];
  assert.deepEqual(moveMotionReference(snapshot, 1, 0), ['swing', 'rest', 'rest']);
  assert.deepEqual(snapshot, ['rest', 'swing', 'rest']);
  assert.deepEqual(moveMotionReference(snapshot, 0, -1), snapshot);
  assert.deepEqual(moveMotionReference(snapshot, 2, 3), snapshot);
});
