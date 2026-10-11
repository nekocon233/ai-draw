import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getMotionReferenceError, getMotionVideoFileError, getMotionVideoFrameCount, isMotionVideoUrl, moveMotionReference,
} from '../src/utils/motionReferences.ts';

const clip = `/uploads/reference/7/${'a'.repeat(32)}.mp4`;

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

test('a motion video replaces the pose images but still needs the subject', () => {
  assert.equal(getMotionReferenceError('character', [], clip), null);
  assert.match(getMotionReferenceError('character', ['pose'], clip) ?? '', /二选一/);
  assert.ok(getMotionReferenceError(null, [], clip));
  assert.match(getMotionReferenceError('character', []) ?? '', /动作视频/);
});

test('only stored clips are motion videos and uploads are checked before sending', () => {
  assert.ok(isMotionVideoUrl(clip));
  for (const value of ['/uploads/video/7/a.mp4', `/uploads/reference/7/${'a'.repeat(32)}.mov`, 'data:video/mp4;base64,AA', null]) {
    assert.equal(isMotionVideoUrl(value), false);
  }
  assert.equal(getMotionVideoFileError({ type: 'video/mp4', name: 'dance.mp4', size: 1024 }), null);
  assert.equal(getMotionVideoFileError({ type: '', name: 'dance.MOV', size: 1024 }), null);
  assert.ok(getMotionVideoFileError({ type: 'image/png', name: 'pose.png', size: 1024 }));
  assert.ok(getMotionVideoFileError({ type: 'video/mp4', name: 'long.mp4', size: 101 * 1024 * 1024 }));
});

test('the generated length mirrors the backend frame grid', () => {
  // Same values as tests/test_minimax_h3.py: at least four seconds, rounded up to 17k+5 frames.
  assert.equal(getMotionVideoFrameCount(2), 107);
  assert.equal(getMotionVideoFrameCount(107 / 24), 107);
  assert.equal(getMotionVideoFrameCount(4.5), 124);
  assert.equal(getMotionVideoFrameCount(5), 124);
  assert.equal(getMotionVideoFrameCount(30), 362);
});
