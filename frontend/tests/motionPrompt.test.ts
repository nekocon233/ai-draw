import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatMessage } from '../src/types/models.ts';
import { MOTION_PROMPT_POLICY, SHOT_MOTION_PROMPT_POLICY, motionPromptSource, motionPromptSourceKey, resolveMotionPrompt } from '../src/utils/motionPrompt.ts';

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
