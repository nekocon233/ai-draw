import assert from 'node:assert/strict';
import test from 'node:test';

import { placeholderAutoSize } from '../src/utils/placeholderAutoSize.ts';

test('a changed placeholder changes minRows by far less than a pixel so the textarea re-measures', () => {
  const autoSize = { minRows: 1, maxRows: 6 };
  const short = placeholderAutoSize(autoSize, '描述你想要生成的图片...');
  const long = placeholderAutoSize(autoSize, '仅补充节奏、停顿、音效等额外内容；动作按参考图生成，可留空');
  assert.ok(typeof short === 'object' && typeof long === 'object');
  assert.notEqual(short.minRows, long.minRows);
  for (const value of [short, long]) {
    assert.equal(value.maxRows, 6);
    assert.ok(value.minRows! > 1 && value.minRows! < 1.001);
  }
  assert.deepEqual(placeholderAutoSize(autoSize, '描述你想要生成的图片...'), short);
  assert.deepEqual(autoSize, { minRows: 1, maxRows: 6 });
});

test('textareas without auto size or placeholder are left unchanged', () => {
  const autoSize = { minRows: 2, maxRows: 4 };
  assert.equal(placeholderAutoSize(autoSize, undefined), autoSize);
  assert.equal(placeholderAutoSize(autoSize, ''), autoSize);
  assert.equal(placeholderAutoSize(true, '提示'), true);
  assert.equal(placeholderAutoSize(undefined, '提示'), undefined);
  const withoutMinRows = placeholderAutoSize({ maxRows: 4 }, '提示');
  assert.ok(typeof withoutMinRows === 'object' && withoutMinRows.minRows! > 1 && withoutMinRows.minRows! < 1.001);
});
