import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPLY_MAX_LENGTH, replyProblem } from './review-reply.ts';

// CF-0043
test('blank and over-long replies are refused, like the API', () => {
  assert.equal(replyProblem('Salamat po!'), null);
  assert.match(replyProblem('   ') ?? '', /Write a reply/);
  assert.equal(replyProblem(` ${'a'.repeat(REPLY_MAX_LENGTH)} `), null);
  assert.match(replyProblem('a'.repeat(REPLY_MAX_LENGTH + 1)) ?? '', /under 1000/);
});
