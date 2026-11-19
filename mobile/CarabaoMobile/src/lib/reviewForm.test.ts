/// <reference types="node" />
// Run with `npm test`. CF-0113.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { canEditReview, checkReview, REVIEW_COMMENT_MAX, starLabel } from './reviewForm.ts';

test('rating must be a whole 1-5', () => {
  for (const bad of [null, 0, 6, 2.5, Number.NaN]) {
    assert.ok('error' in checkReview(bad, ''), String(bad));
  }
  assert.deepEqual(checkReview(5, ''), { ok: { rating: 5, comment: null } });
});

test('comment is trimmed, blank is null, capped at the backend limit', () => {
  assert.deepEqual(checkReview(4, '  Fresh kale!  '), { ok: { rating: 4, comment: 'Fresh kale!' } });
  assert.deepEqual(checkReview(4, '   '), { ok: { rating: 4, comment: null } });
  assert.ok('error' in checkReview(4, 'x'.repeat(REVIEW_COMMENT_MAX + 1)));
  assert.ok('ok' in checkReview(4, ` ${'x'.repeat(REVIEW_COMMENT_MAX)} `)); // limit is after trimming, like the backend
});

test('edits only while the window is open', () => {
  const now = Date.parse('2026-11-19T00:00:00Z');
  assert.equal(canEditReview('2026-11-20T00:00:00Z', now), true);
  assert.equal(canEditReview('2026-11-19T00:00:00Z', now), true);
  assert.equal(canEditReview('2026-11-18T23:59:59Z', now), false);
  for (const v of [null, undefined, '', 'bad']) assert.equal(canEditReview(v, now), false, String(v));
});

test('star labels', () => {
  assert.equal(starLabel(1), '1 star');
  assert.equal(starLabel(4), '4 stars');
});

test('comment limit = backend schemas/review.py', () => {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const py = readFileSync(join(repo, 'backend/app/schemas/review.py'), 'utf8');
  assert.match(py, new RegExp(`^COMMENT_MAX_LENGTH = ${REVIEW_COMMENT_MAX}\\b`, 'm'));
});
