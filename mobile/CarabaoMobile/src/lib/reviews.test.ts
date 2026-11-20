/// <reference types="node" />
// Run with `npm test`. CF-0112.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  breakdownRows, farmReplyLabel, hasMoreReviews, mergeReviews, myReviewsQuery, replaceReview, REPLY_MAX_LENGTH, replyProblem,
  reviewSummary, shownReply, stars, toggleRating, wasEdited, type PublicReview,
} from './reviews.ts';

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

test('merchant reviews query: repeated rating keys, comment filter, paging (CF-0119)', () => {
  assert.equal(myReviewsQuery({ ratings: [], hasComment: null }, 0), 'limit=20&offset=0');
  assert.equal(myReviewsQuery({ ratings: [5, 1, 5, 9, 2.5], hasComment: true }, 40), 'rating=1&rating=5&has_comment=true&limit=20&offset=40');
  assert.equal(myReviewsQuery({ ratings: [3], hasComment: false }, -3, 10), 'rating=3&has_comment=false&limit=10&offset=0');
});

test('breakdown: 5 to 1 stars, string keys, whole percentages', () => {
  assert.deepEqual(breakdownRows({ '5': 3, '4': 1 }, 4), [
    { stars: 5, count: 3, percent: 75 }, { stars: 4, count: 1, percent: 25 },
    { stars: 3, count: 0, percent: 0 }, { stars: 2, count: 0, percent: 0 }, { stars: 1, count: 0, percent: 0 },
  ]);
  assert.equal(breakdownRows({}, 0)[0].percent, 0);
});

test('star filter toggles', () => {
  assert.deepEqual(toggleRating([], 4), [4]);
  assert.deepEqual(toggleRating([4, 1], 2), [1, 2, 4]);
  assert.deepEqual(toggleRating([1, 4], 4), [1]);
});

// ---- CF-0133 (M55): the farm's reply ----

test('CF-0133 replyProblem: same rules and texts as web lib/review-reply.ts', () => {
  assert.equal(replyProblem(''), 'Write a reply first.');
  assert.equal(replyProblem('   \n '), 'Write a reply first.');
  assert.equal(replyProblem('Thank you!'), null);
  assert.equal(replyProblem(` ${'a'.repeat(REPLY_MAX_LENGTH)} `), null); // trimmed, like the API
  assert.equal(replyProblem('a'.repeat(REPLY_MAX_LENGTH + 1)), 'Keep your reply under 1000 characters.');
});

test('CF-0133 farm reply label and shown reply', () => {
  assert.equal(farmReplyLabel('Mang Ben Farm'), 'Reply from Mang Ben Farm');
  assert.equal(farmReplyLabel('  '), 'Reply from the farm');
  assert.equal(farmReplyLabel(null), 'Reply from the farm');
  assert.equal(shownReply(r(1, { merchant_reply: ' Salamat! ' })), 'Salamat!');
  assert.equal(shownReply(r(1, { merchant_reply: '  ' })), null);
  assert.equal(shownReply(r(1, { merchant_reply: null })), null);
  assert.equal(shownReply(r(1)), null);
});

test('CF-0133 replaceReview keeps the order and changes only the same id', () => {
  const list = [r(1), r(2), r(3)];
  const next = replaceReview(list, r(2, { merchant_reply: 'Thanks' }));
  assert.deepEqual(next.map((x) => x.id), [1, 2, 3]);
  assert.equal(next[1].merchant_reply, 'Thanks');
  assert.equal(next[0], list[0]);
  assert.deepEqual(replaceReview(list, r(9)), list);
});
