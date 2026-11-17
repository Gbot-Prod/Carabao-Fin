import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockingLineCount, cartIssueMessage, type CartIssueStrings } from './cart-issues.ts';

// CF-0042
const S: CartIssueStrings = {
  issueUnavailable: 'gone',
  issueExpired: 'expired',
  issueFarmUnavailable: 'farm off',
  issueOwnListing: 'own',
  issueBelowMinimum: 'min {qty}',
  issueExceedsStock: 'only {qty}',
};

test('message per issue, with quantities filled in', () => {
  assert.equal(cartIssueMessage({ issue: 'unavailable' }, S), 'gone');
  assert.equal(cartIssueMessage({ issue: 'expired' }, S), 'expired');
  assert.equal(cartIssueMessage({ issue: 'farm_unavailable' }, S), 'farm off');
  assert.equal(cartIssueMessage({ issue: 'own_listing' }, S), 'own');
  assert.equal(cartIssueMessage({ issue: 'below_minimum', min_order_qty: 5 }, S), 'min 5');
  assert.equal(cartIssueMessage({ issue: 'exceeds_stock', stock_quantity: 2 }, S), 'only 2');
});

test('no issue, or an issue this build does not know, gives no message', () => {
  assert.equal(cartIssueMessage({}, S), null);
  assert.equal(cartIssueMessage({ issue: null }, S), null);
  assert.equal(cartIssueMessage({ issue: 'something_new' as never }, S), null);
});

test('every flagged line blocks checkout', () => {
  assert.equal(blockingLineCount([]), 0);
  assert.equal(blockingLineCount([{ issue: null }, { issue: 'expired' }, { issue: 'exceeds_stock' }]), 2);
});
