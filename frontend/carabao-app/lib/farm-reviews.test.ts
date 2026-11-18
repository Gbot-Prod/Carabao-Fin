import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendReviews, hasMoreReviews, reviewDate, starsText } from './farm-reviews.ts';

// CF-0046
test('pages are appended in order without repeats', () => {
  const loaded = [{ id: 5 }, { id: 4 }];
  assert.deepEqual(appendReviews(loaded, [{ id: 4 }, { id: 3 }]), [{ id: 5 }, { id: 4 }, { id: 3 }]);
  assert.deepEqual(appendReviews([], [{ id: 1 }]), [{ id: 1 }]);
  assert.equal(loaded.length, 2); // input not changed
});

test('show more only while reviews are left', () => {
  assert.equal(hasMoreReviews(5, 12), true);
  assert.equal(hasMoreReviews(12, 12), false);
  assert.equal(hasMoreReviews(0, 0), false);
});

test('stars are clamped to 0..5', () => {
  assert.equal(starsText(4), '★★★★☆');
  assert.equal(starsText(5), '★★★★★');
  assert.equal(starsText(9), '★★★★★');
  assert.equal(starsText(-1), '☆☆☆☆☆');
  assert.equal(starsText(Number.NaN), '☆☆☆☆☆');
});

test('review dates use Manila days and survive bad input', () => {
  // 16:30 UTC on 17 Nov is 00:30 on 18 Nov in Manila.
  assert.match(reviewDate('2026-11-17T16:30:00Z', 'en'), /18/);
  assert.equal(reviewDate('not a date', 'en'), '');
});
