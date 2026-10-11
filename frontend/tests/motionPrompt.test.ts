import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatMessage } from '../src/types/models.ts';
import {
  FACE_MOTION_PROMPT_POLICY, MOTION_PROMPT_POLICY, SHOT_MOTION_PROMPT_POLICY, VIDEO_FACE_MOTION_PROMPT_POLICY,
  VIDEO_MOTION_PROMPT_POLICY, VIDEO_SHOT_MOTION_PROMPT_POLICY, motionPromptSource, motionPromptSourceKey, motionReferenceMode,
  resolveMotionPrompt,
} from '../src/utils/motionPrompt.ts';

const snapshot = {version:1 as const,input_hash:'a'.repeat(64),prompt:'识别的动作'};
const history: ChatMessage[] = [{id:'m',session_id:'s',type:'user',content:'缓慢',timestamp:1,params:{workflow:'minimax_h3_ref',referenceImage:'character',motionReferenceImages:['a','b'],motionPrompt:snapshot}}];

test('history analysis is reused only for the same character, ordered poses and description', () => {
  assert.equal(resolveMotionPrompt(null,history,motionPromptSource('character',['a','b'],'缓慢')),snapshot);
  assert.equal(resolveMotionPrompt(null,history,motionPromptSource('character',['b','a'],'缓慢')),null);
  assert.equal(resolveMotionPrompt(null,history,motionPromptSource('other',['a','b'],'缓慢')),null);
  assert.equal(resolveMotionPrompt(null,history,motionPromptSource('character',['a','b'],'快速')),null);
});

test('manual edits are preserved and source keys exclude generated text', () => {
  const source = motionPromptSource('character',['a','b'],'');
  const edited = {...snapshot,prompt:'手动调整幅度'};
  assert.equal(resolveMotionPrompt(edited,history,source),edited);
  assert.equal(motionPromptSourceKey(source),JSON.stringify([1,MOTION_PROMPT_POLICY,'character',['a','b'],'']));
  assert.notEqual(motionPromptSourceKey(source),motionPromptSourceKey(motionPromptSource('character',['b','a'],'')));
});

test('reference-shot presets bind analysis to their own policy while pose keys stay unchanged', () => {
  const shot = {id:'video_reference_shot',title:'参考镜头动作',description:'',prompt:'参考镜头。',hint:'',images:[],motion_reference_mode:'shot' as const};
  const source = motionPromptSource('character',['a'],'雨夜',shot);
  assert.equal(source.motion_reference_mode,'shot');
  assert.equal(motionPromptSourceKey(source),JSON.stringify([1,SHOT_MOTION_PROMPT_POLICY,'character',['a'],'参考镜头。雨夜']));
  const legacy = motionPromptSource('character',['a'],'雨夜',{...shot,motion_reference_mode:undefined});
  assert.equal(legacy.motion_reference_mode,'pose');
  assert.equal(motionPromptSourceKey(legacy),JSON.stringify([1,MOTION_PROMPT_POLICY,'character',['a'],'参考镜头。雨夜']));
  const shotHistory: ChatMessage[] = [{...history[0],content:'雨夜',params:{...history[0].params!,motionReferenceImages:['a'],promptPreset:shot}}];
  assert.equal(resolveMotionPrompt(null,shotHistory,source),snapshot);
  assert.equal(resolveMotionPrompt(null,shotHistory,legacy),null);
});

test('motion videos use their own policies and keys that mirror the backend hash input', () => {
  const clip = `/uploads/reference/7/${'a'.repeat(32)}.mp4`;
  const source = motionPromptSource('character', ['ignored'], '轻快', null, clip);
  assert.deepEqual(source.motion_reference_images, []);
  assert.equal(motionPromptSourceKey(source), JSON.stringify([1, VIDEO_MOTION_PROMPT_POLICY, 'character', clip, '轻快']));
  const shot = {id:'video_reference_shot',title:'参考镜头动作',description:'',prompt:'参考镜头。',hint:'',images:[],motion_reference_mode:'shot' as const};
  assert.equal(motionPromptSourceKey(motionPromptSource('character', [], '', shot, clip)),
    JSON.stringify([1, VIDEO_SHOT_MOTION_PROMPT_POLICY, 'character', clip, '参考镜头。']));
  // Pose keys are unchanged when no video is attached.
  assert.equal(motionPromptSourceKey(motionPromptSource('character', ['a'], '轻快')), JSON.stringify([1, MOTION_PROMPT_POLICY, 'character', ['a'], '轻快']));
  const videoHistory: ChatMessage[] = [{...history[0], content:'轻快', params:{...history[0].params!, motionReferenceImages:[], motionReferenceVideo:clip}}];
  assert.equal(resolveMotionPrompt(null, videoHistory, source), snapshot);
  assert.equal(resolveMotionPrompt(null, videoHistory, motionPromptSource('character', [], '轻快', null, clip.replace('a', 'b'))), null);
  assert.equal(resolveMotionPrompt(null, videoHistory, motionPromptSource('character', [], '轻快')), null);
});

test('face-swap presets bind analysis to their own image and video policies', () => {
  const clip = `/uploads/reference/7/${'a'.repeat(32)}.mp4`;
  const face = {id:'video_reference_face',title:'参考镜头换脸',description:'',prompt:'换脸。',hint:'',images:[],motion_reference_mode:'face' as const};
  const images = motionPromptSource('character', ['a'], '雨夜', face);
  assert.equal(images.motion_reference_mode, 'face');
  assert.equal(motionPromptSourceKey(images), JSON.stringify([1, FACE_MOTION_PROMPT_POLICY, 'character', ['a'], '换脸。雨夜']));
  assert.equal(motionPromptSourceKey(motionPromptSource('character', [], '雨夜', face, clip)),
    JSON.stringify([1, VIDEO_FACE_MOTION_PROMPT_POLICY, 'character', clip, '换脸。雨夜']));
  const faceHistory: ChatMessage[] = [{...history[0], content:'雨夜', params:{...history[0].params!, motionReferenceImages:['a'], promptPreset:face}}];
  assert.equal(resolveMotionPrompt(null, faceHistory, images), snapshot);
  assert.equal(resolveMotionPrompt(null, faceHistory, motionPromptSource('character', ['a'], '雨夜', {...face, motion_reference_mode:'shot'})), null);
  // Unknown or missing modes (historical snapshots) fall back to the fixed-scene pose mode.
  assert.equal(motionReferenceMode(undefined), 'pose');
  assert.equal(motionReferenceMode('scene'), 'pose');
});
