import assert from 'node:assert/strict';
import test from 'node:test';
import { clampLoraPromptStrengths, formatLoraPromptForDisplay, getLoraPromptError, parseLoraPrompt, serializeLoraSelections } from '../src/utils/loraOptions.ts';

test('history tags show registered LoRA names and keep unknown IDs readable', () => {
  const labels = { AmeniwaQwen21Bilingual: 'Ameniwa' };
  assert.equal(formatLoraPromptForDisplay('<lora:AmeniwaQwen21Bilingual:0.8>', labels), 'Ameniwa:0.8');
  assert.equal(formatLoraPromptForDisplay('<lora:AmeniwaQwen21Bilingual.safetensors:0.65> <lora:AmeniwaQwen21V3:1>', labels), 'Ameniwa:0.65 AmeniwaQwen21V3:1');
  assert.equal(formatLoraPromptForDisplay('<lora:styles/ink:0.5>'), 'styles/ink:0.5');
});

test('restores saved LoRA names, subdirectories and individual strengths', () => {
  assert.deepEqual(parseLoraPrompt('<lora:AmeniwaQwen21Bilingual.safetensors:0.8> <lora:styles/ink:0.55>'), {
    selections: [{ name: 'AmeniwaQwen21Bilingual', strength: 0.8 }, { name: 'styles/ink', strength: 0.55 }],
    unparsed: '',
  });
});

test('preserves historical strengths when parsing and serializing saved records', () => {
  const value = '<lora:old:-0.5> <lora:other:2.5>';
  assert.equal(serializeLoraSelections(parseLoraPrompt(value).selections), value);
});

test('limits settings drafts to zero through one while keeping every selected model', () => {
  const saved = '<lora:old:-0.5> <lora:styles/ink.safetensors:2.5> <lora:other:0.65>';
  assert.equal(clampLoraPromptStrengths(saved), '<lora:old:0> <lora:styles/ink:1> <lora:other:0.65>');
  assert.equal(parseLoraPrompt(saved).selections[1].strength, 2.5);
});

test('leaves valid bounds and malformed legacy configurations untouched', () => {
  for (const saved of ['', '<lora:a:0> <lora:b:1>', '<lora:a:.8>, <lora:b:+1>', '<lora:a:2> unknown']) {
    assert.equal(clampLoraPromptStrengths(saved), saved);
  }
});

test('serializes the selected models for the existing generation and history contract', () => {
  assert.equal(serializeLoraSelections([{ name: 'AmeniwaQwen21Bilingual', strength: 0.65 }]), '<lora:AmeniwaQwen21Bilingual:0.65>');
  assert.equal(serializeLoraSelections([]), '');
});

test('supports old decimal syntax and common separators', () => {
  assert.deepEqual(parseLoraPrompt('<lora:a:.8>, <lora:b:+1>\n'), {
    selections: [{ name: 'a', strength: 0.8 }, { name: 'b', strength: 1 }], unparsed: '',
  });
});

test('does not silently discard malformed legacy configuration', () => {
  for (const value of ['<lora:style:bad>', '<lora:style:0.8> unknown', '<lora:style:NaN>']) {
    assert.ok(parseLoraPrompt(value).unparsed);
    assert.ok(getLoraPromptError(value));
  }
});

test('allows no LoRA and a selected adapter', () => {
  assert.equal(getLoraPromptError(''), undefined);
  assert.equal(getLoraPromptError('<lora:AmeniwaQwen21Bilingual:0.8>'), undefined);
});

test('prevents oversized multi-LoRA settings from exceeding persisted columns', () => {
  assert.ok(getLoraPromptError(serializeLoraSelections([{ name: 'a'.repeat(250), strength: 0.8 }])));
});
