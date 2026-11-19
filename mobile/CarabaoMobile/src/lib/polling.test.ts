/// <reference types="node" />
// Run with `npm test`. CF-0117.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumed, shouldPoll, UNREAD_COUNT_QUERY } from './polling.ts';

test('poll only in view, in the foreground, and when enabled', () => {
  assert.equal(shouldPoll(true, 'active'), true);
  assert.equal(shouldPoll(false, 'active'), false); // another screen or tab on top
  for (const s of ['background', 'inactive', 'unknown', 'extension']) assert.equal(shouldPoll(true, s), false, s);
  assert.equal(shouldPoll(true, 'active', false), false);
});

test('coming back starts a fetch at once', () => {
  assert.equal(resumed(false, true), true);
  assert.equal(resumed(true, true), false);
  assert.equal(resumed(true, false), false);
  assert.equal(resumed(false, false), false);
});

test('the bell asks for the count, not the whole list', () => {
  assert.match(UNREAD_COUNT_QUERY, /unread_only=true/);
  assert.match(UNREAD_COUNT_QUERY, /limit=1\b/);
});
