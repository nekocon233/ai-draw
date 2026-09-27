import assert from 'node:assert/strict';
import test from 'node:test';
import { compactImageReferences, findImageMentionQuery, getImageMentionError, getPresetBlocker, getPresetWorkflowBlocker, getWorkflowPresets, insertImageMention, REMOVED_IMAGE_MENTION, supportsImageMentions } from '../src/utils/imageMentions.ts';

test('finds @ at the caret with Chinese text, numeric search and multiline prompts', () => {
  for (const text of ['@', '把@', '把 @图', '把 @图片', '把 @图片2', '第一行\n@2']) {
    const query = findImageMentionQuery(text, text.length);
    assert(query, text);
    assert.equal(query.start, text.lastIndexOf('@'));
  }
  for (const text of ['me@example.com', 'user@', '@图片1 ', '@朋友', '@@', '文字']) {
    assert.equal(findImageMentionQuery(text, text.length), null, text);
  }
  assert.equal(findImageMentionQuery('@图片', 1, 3), null);
});

test('inserts at the current caret without discarding later text or requiring a new image', () => {
  const text = '把 @ 的衣服换成 @图片2 的款式';
  const query = findImageMentionQuery(text, 3)!;
  assert.deepEqual(insertImageMention(text, query, 1), { value: '把 @图片1  的衣服换成 @图片2 的款式', caret: 7 });
  assert.equal(insertImageMention('@图片', findImageMentionQuery('@图片', 3)!, 2).value, '@图片2 ');
});

test('deleting a reference marks only its tokens and renumbers surviving aliases in one pass', () => {
  const result = compactImageReferences('把@图片1和@图片2放到@图片3旁，再参考<image2>和@图片2。', [null, 'b', 'c']);
  assert.deepEqual(result, { images: ['b', 'c'], prompt: `把${REMOVED_IMAGE_MENTION}和@图片1放到@图片2旁，再参考<image1>和@图片1。` });
  assert.match(getImageMentionError(result.prompt, result.images)!, /已移除/);
});

test('replacement keeps the slot, while deleting the last image cannot rebind a removed alias', () => {
  assert.deepEqual(compactImageReferences('@图片1 @图片2', ['replacement', 'b']), { prompt: '@图片1 @图片2', images: ['replacement', 'b'] });
  const removed = compactImageReferences('@图片1', [null, null, null]);
  const readded = compactImageReferences(removed.prompt, ['replacement', null, null]);
  assert.equal(readded.prompt, REMOVED_IMAGE_MENTION);
  assert.match(getImageMentionError(readded.prompt, readded.images)!, /已移除/);
});

test('sparse history slots and duplicate image URLs retain positional identity', () => {
  assert.deepEqual(compactImageReferences('@图片3 <image3>', ['a', null, 'c']), { images: ['a', 'c'], prompt: '@图片2 <image2>' });
  assert.deepEqual(compactImageReferences('@图片1 @图片2 @图片3', ['same', null, 'same']), { images: ['same', 'same'], prompt: `@图片1 ${REMOVED_IMAGE_MENTION} @图片2` });
});

test('validates all reserved indices without rewriting emails or partial text', () => {
  for (const prompt of ['@图片0', '@图片4', '@图片10', '<image0>', '<image3>']) assert(getImageMentionError(prompt, ['a', 'b']), prompt);
  assert(getImageMentionError('@图片2', ['a', null, 'c']));
  for (const prompt of ['普通文字 @', 'mail@example.com', 'user@图片3.com', '@图片1和<image2>，@图片2。']) {
    assert.equal(getImageMentionError(prompt, ['a', 'b']), null, prompt);
  }
});

test('only multireference image workflows enable the picker', () => {
  const metadata = { key: 'gpt_image', label: 'GPT', description: '', requires_image: false, parameters: [], supports_multi_image: true };
  assert(supportsImageMentions(metadata));
  assert(!supportsImageMentions({ ...metadata, output_type: 'video' }));
  assert(!supportsImageMentions({ ...metadata, supports_multi_image: false }));
  assert(!supportsImageMentions(undefined));
});

test('presets need a capable workflow and every slot they mention or declare', () => {
  const metadata = { key: 'qwen_image_21_i2i', label: 'Qwen', description: '', requires_image: true, parameters: [], supports_multi_image: true };
  const role = (label: string) => ({ label, role: '' });
  const plain = { prompt: '保持构图。', images: [] };
  const sketch = { prompt: '@图片1 是线稿草稿。', images: [role('参考图 1')] };
  const pose = { prompt: '参照第二张图中人物的动作。', images: [role('参考图 1'), role('参考图 2')] };
  assert.equal(getPresetBlocker(plain, undefined, []), null);
  assert.equal(getPresetWorkflowBlocker(pose, { ...metadata, supports_multi_image: false }), '当前工作流不支持引用参考图');
  assert.equal(getPresetWorkflowBlocker(sketch, undefined), '当前工作流不支持引用参考图');
  // Choosing a preset before adding images is allowed; sending is not.
  assert.equal(getPresetWorkflowBlocker(sketch, metadata), null);
  assert.equal(getPresetBlocker(sketch, metadata, [null, 'b']), '请先添加参考图 1');
  assert.equal(getPresetBlocker(pose, metadata, ['a']), '请先添加参考图 2');
  assert.equal(getPresetBlocker({ prompt: '@图片1 参考 @图片2', images: [] }, metadata, ['a']), '请先添加参考图 2');
  assert.equal(getPresetBlocker(sketch, metadata, ['a']), null);
});

test('video presets bind the end frame separately from ordinary reference image two', () => {
  const video = { key: 'minimax_h3', label: 'H3', description: '', output_type: 'video', requires_image: false, supports_optional_keyframes: true, parameters: [] };
  const transition = {
    prompt: '本段起始帧过渡到结束帧。', output_type: 'video' as const,
    images: [{ label: '开始帧', role: '', slot: 1 as const }, { label: '结束帧', role: '', slot: 'end' as const }],
  };
  assert.equal(getPresetWorkflowBlocker(transition, video), null);
  assert.equal(getPresetBlocker(transition, video, [], 'end'), '请先添加开始帧');
  assert.equal(getPresetBlocker(transition, video, ['start', 'ordinary-reference']), '请先添加结束帧');
  assert.equal(getPresetBlocker(transition, video, ['start'], 'end'), null);
  assert.equal(getPresetWorkflowBlocker(transition, { ...video, key: 'minimax_h3_ref', requires_image: true, supports_optional_keyframes: false }), '当前工作流不支持结束帧');
  const optional = { ...video, key: 'minimax_h3', requires_image: false, requires_end_image: false, supports_optional_keyframes: true };
  assert.equal(getPresetBlocker(transition, optional, ['start']), '请先添加结束帧');
  assert.equal(getPresetBlocker(transition, optional, ['start'], 'end'), null);
});

test('preset lists separate images and videos while preserving legacy image snapshots', () => {
  const common = { title: 'Preset', description: '', hint: '', prompt: '生成画面。', images: [] };
  const presets = [{ ...common, id: 'legacy-image' }, { ...common, id: 'video', output_type: 'video' as const }];
  const image = { key: 'qwen', label: 'Qwen', description: '', requires_image: false, parameters: [], supports_multi_image: true };
  const video = { ...image, key: 'minimax_h3_ref', output_type: 'video', supports_multi_image: false, requires_image: true };
  assert.deepEqual(getWorkflowPresets(presets, image).map(preset => preset.id), ['legacy-image']);
  assert.deepEqual(getWorkflowPresets(presets, video).map(preset => preset.id), ['video']);
  assert(getPresetWorkflowBlocker(presets[0], video));
  assert(getPresetWorkflowBlocker(presets[1], image));
});

test('fixed-camera motion presets require a motion-capable workflow and actual pose images', () => {
  const preset = { prompt: '按动作参考图运动，文字只补充额外内容。', output_type:'video' as const, requires_motion_reference:true,
    images:[{label:'原始画面',role:'主体与镜头',slot:1 as const}] };
  const video = {key:'minimax_h3_ref',label:'video',description:'',output_type:'video',requires_image:true,parameters:[]};
  assert.equal(getPresetWorkflowBlocker(preset,video),'此预设需要支持动作参考图的生成方式');
  const motion = {...video,key:'minimax_h3_ref',supports_motion_reference:true};
  assert.equal(getPresetWorkflowBlocker(preset,motion),null);
  assert.equal(getPresetBlocker(preset,motion,[]),'请先添加原始画面');
  assert.equal(getPresetBlocker(preset,motion,['character'],undefined,[]),'请先添加动作参考图');
  assert.equal(getPresetBlocker(preset,motion,['character'],undefined,['pose']),null);
  assert.equal(getPresetBlocker({...preset,requires_motion_reference:undefined},video,['character']),null);
  // Reference-shot presets name their subject image; legacy snapshots without a label keep the old wording.
  const shot = {...preset,images:[{label:'主体图',role:'只提供外观',slot:1 as const}]};
  assert.equal(getPresetBlocker(shot,motion,[]),'请先添加主体图');
  assert.equal(getPresetBlocker({...preset,images:[{label:'',role:'',slot:1 as const}]},motion,[]),'请先添加原始画面');
});
