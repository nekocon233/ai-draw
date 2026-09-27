import assert from 'node:assert/strict';
import test from 'node:test';

import type { MotionPromptSnapshot } from '../src/types/api.ts';
import {
  captureComposer,
  EMPTY_COMPOSER_DRAFT,
  fromApiInputDrafts,
  inputGroupOf,
  switchComposer,
  toApiInputDrafts,
  type ComposerDraft,
} from '../src/utils/composerDrafts.ts';

const motionPrompt: MotionPromptSnapshot = {
  version: 1,
  input_hash: 'a'.repeat(64),
  prompt: '按参考图顺序挥手。',
};

const imageComposer: ComposerDraft = {
  prompt: '红色外套',
  referenceImage: '/uploads/sketch.png',
  referenceImage2: '/uploads/color.png',
  referenceImage3: null,
  referenceImageEnd: null,
  motionReferenceImages: [],
  motionPrompt: null,
  parkedReferences: { images: ['/uploads/parked.png'], endImage: null },
};

const videoComposer: ComposerDraft = {
  prompt: '头发细微飘动',
  referenceImage: '/uploads/subject.png',
  referenceImage2: null,
  referenceImage3: null,
  referenceImageEnd: '/uploads/end.png',
  motionReferenceImages: ['/uploads/pose-1.png', '/uploads/pose-2.png'],
  motionPrompt,
  parkedReferences: { images: [], endImage: null },
};

test('video workflows use the video composer and everything else the image composer', () => {
  assert.equal(inputGroupOf({ output_type: 'video' }), 'video');
  assert.equal(inputGroupOf({ output_type: 'image' }), 'image');
  assert.equal(inputGroupOf({}), 'image');
  assert.equal(inputGroupOf(undefined), 'image');
});

test('switching within one output type keeps the live composer untouched', () => {
  const drafts = { video: videoComposer };
  const switched = switchComposer(imageComposer, drafts, 'image', 'image');
  assert.equal(switched.composer, imageComposer);
  assert.equal(switched.drafts, drafts);
});

test('switching output types stashes the live input and restores the other one', () => {
  const toVideo = switchComposer(imageComposer, {}, 'image', 'video');
  assert.deepEqual(toVideo.composer, EMPTY_COMPOSER_DRAFT);
  assert.deepEqual(toVideo.drafts, { image: imageComposer });

  const back = switchComposer(videoComposer, toVideo.drafts, 'video', 'image');
  assert.deepEqual(back.composer, imageComposer);
  assert.deepEqual(back.drafts, { video: videoComposer });

  const again = switchComposer(imageComposer, back.drafts, 'image', 'video');
  assert.deepEqual(again.composer, videoComposer);
  assert.deepEqual(again.drafts, { image: imageComposer });
});

test('stashed input does not share arrays with the live composer', () => {
  const live = captureComposer(videoComposer);
  const { drafts } = switchComposer(live, {}, 'video', 'image');
  live.motionReferenceImages.push('/uploads/pose-3.png');
  live.parkedReferences.images.push('/uploads/late.png');
  assert.deepEqual(drafts.video?.motionReferenceImages, videoComposer.motionReferenceImages);
  assert.deepEqual(drafts.video?.parkedReferences.images, []);
});

test('saved drafts mirror the live composer and keep the other output type', () => {
  const saved = toApiInputDrafts({ image: imageComposer, video: { ...videoComposer, prompt: '旧内容' } }, 'video', videoComposer);
  assert.deepEqual(saved, {
    image: {
      prompt: '红色外套',
      reference_image: '/uploads/sketch.png',
      reference_image_2: '/uploads/color.png',
      reference_image_3: null,
      reference_image_end: null,
      motion_reference_images: [],
      motion_prompt: null,
      parked_images: ['/uploads/parked.png'],
      parked_end_image: null,
    },
    video: {
      prompt: '头发细微飘动',
      reference_image: '/uploads/subject.png',
      reference_image_2: null,
      reference_image_3: null,
      reference_image_end: '/uploads/end.png',
      motion_reference_images: ['/uploads/pose-1.png', '/uploads/pose-2.png'],
      motion_prompt: motionPrompt,
      parked_images: [],
      parked_end_image: null,
    },
  });
  const cleared = toApiInputDrafts({ video: { ...videoComposer, motionPrompt: { ...motionPrompt, prompt: '  ' } } }, 'image', imageComposer);
  assert.equal(cleared.video?.motion_prompt, null);
  assert.deepEqual(toApiInputDrafts({}, 'image', EMPTY_COMPOSER_DRAFT), {
    image: {
      prompt: '',
      reference_image: null,
      reference_image_2: null,
      reference_image_3: null,
      reference_image_end: null,
      motion_reference_images: [],
      motion_prompt: null,
      parked_images: [],
      parked_end_image: null,
    },
  });
});

test('restored drafts round-trip and ignore malformed values', () => {
  assert.deepEqual(fromApiInputDrafts(toApiInputDrafts({ image: imageComposer }, 'video', videoComposer)), {
    image: imageComposer,
    video: videoComposer,
  });
  assert.deepEqual(fromApiInputDrafts(null), {});
  assert.deepEqual(fromApiInputDrafts('broken'), {});
  assert.deepEqual(fromApiInputDrafts({
    image: 'broken',
    video: {
      prompt: 3,
      reference_image: '',
      reference_image_end: '/uploads/end.png',
      motion_reference_images: ['/uploads/pose-1.png', 4, ''],
      motion_prompt: { ...motionPrompt, version: 2 },
      parked_images: 'broken',
    },
  }), {
    video: {
      ...EMPTY_COMPOSER_DRAFT,
      referenceImageEnd: '/uploads/end.png',
      motionReferenceImages: ['/uploads/pose-1.png'],
    },
  });
});
