/// <reference types="node" />
// Run with `npm test`. CF-0112.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasMoreReviews, mergeReviews, reviewSummary, stars, wasEdited, type PublicReview } from './reviews.ts';

const r = (id: number, over: Partial<PublicReview> = {}): PublicReview => ({
  id, merchant_id: 1, rating: 4, comment: null, reviewer_name: 'Ana',
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', ...over,
});

test('stars are clamped and rounded', () => {
  assert.equal(stars(4), '★★★★☆');
  assert.equal(stars(4.6), '★★★★★');
  assert.equal(stars(9), '★★★★★');
  assert.equal(stars(-2), '☆☆☆☆☆');
  assert.equal(stars(Number.NaN), '☆☆☆☆☆');
});

test('summary: no reviews, one, many', () => {
  assert.equal(reviewSummary(null, 0), 'No reviews yet');
  assert.equal(reviewSummary(4.5, 0), 'No reviews yet');
  assert.equal(reviewSummary(5, 1), '5.0 · 1 review');
  assert.equal(reviewSummary(4.25, 12), '4.3 · 12 reviews');
});

test('more pages append without duplicates; "more" until all are shown', () => {
  assert.deepEqual(mergeReviews([r(1), r(2)], [r(2), r(3)]).map((x) => x.id), [1, 2, 3]);
  assert.equal(hasMoreReviews(5, 12), true);
  assert.equal(hasMoreReviews(12, 12), false);
  assert.equal(hasMoreReviews(0, 0), false);
});

test('edited only when changed more than a minute later', () => {
  assert.equal(wasEdited(r(1)), false);
  assert.equal(wasEdited(r(1, { updated_at: '2026-11-01T00:00:30Z' })), false);
  assert.equal(wasEdited(r(1, { updated_at: '2026-11-02T00:00:00Z' })), true);
  assert.equal(wasEdited(r(1, { updated_at: 'bad' })), false);
});
