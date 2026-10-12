import assert from 'node:assert/strict';
import test from 'node:test';
import { readSessionLink } from '../src/features/agent/deepLink.ts';

test('reads a session id from the link and rejects anything else', () => {
  assert.equal(readSessionLink('https://aidraw.nekocon.cn/?session=session-0f8b3c2a-1d4e-4c6b-9a1f-2b3c4d5e6f70'),
    'session-0f8b3c2a-1d4e-4c6b-9a1f-2b3c4d5e6f70');
  assert.equal(readSessionLink('https://aidraw.nekocon.cn/?foo=1'), null);
  assert.equal(readSessionLink('https://aidraw.nekocon.cn/?session=../../etc'), null);
  assert.equal(readSessionLink(`https://aidraw.nekocon.cn/?session=${'x'.repeat(51)}`), null);
  assert.equal(readSessionLink('not a url'), null);
});
