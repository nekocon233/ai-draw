import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatMessage } from '../src/types/models.ts';
import { MOTION_PROMPT_POLICY, motionPromptSource, motionPromptSourceKey, resolveMotionPrompt } from '../src/utils/motionPrompt.ts';

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
