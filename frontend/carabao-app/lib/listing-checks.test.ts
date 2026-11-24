// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasBlocks, notesByField, savedMessage, statusNote, unplacedMessages } from './listing-checks.ts';
import type { ProduceCheckResult } from '../util/api/produce.ts';

const result: ProduceCheckResult = {
  valid: false,
  has_hard_blocks: true,
  has_soft_flags: true,
  recommended_status: 'under_review',
  hard_blocks: [{ field: 'name', code: 'CONTACT_INFO_DETECTED', message: 'Remove a phone number.' }],
  soft_flags: [{ field: 'category', code: 'CATEGORY_MISMATCH', message: 'Put it under Fruits.', suggestion: 'Fruits' }],
};

test('results are grouped per field', () => {
  const notes = notesByField(result);
  assert.deepEqual(notes.name.blocks, ['Remove a phone number.']);
  assert.equal(notes.category.flags[0].suggestion, 'Fruits');
  assert.equal(hasBlocks(notes), true);
  assert.equal(hasBlocks(notesByField(null)), false);
});

test('a save refusal shows first and the same text only once', () => {
  const notes = notesByField(result, { name: 'Remove a phone number.', price_tiers: 'Tier too high' });
  assert.deepEqual(notes.name.blocks, ['Remove a phone number.']);
  assert.deepEqual(notes.price_tiers.blocks, ['Tier too high']);
});

test('messages for a field the form does not have are kept', () => {
  const notes = notesByField(null, { unit: 'Bad unit' });
  assert.deepEqual(unplacedMessages(notes, ['name']), ['Bad unit']);
});

test('the review state of a listing', () => {
  assert.equal(statusNote({ status: 'live', rejection_reason: null }), null);
  assert.equal(statusNote({ status: 'under_review', rejection_reason: null })?.tone, 'review');
  const rejected = statusNote({ status: 'rejected', rejection_reason: 'Wrong category.' });
  assert.match(rejected?.text ?? '', /Wrong category\./);
  assert.ok(savedMessage('under_review'));
  assert.equal(savedMessage('live'), null);
});
