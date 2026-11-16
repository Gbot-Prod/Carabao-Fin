// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merchantPageForNotification } from './merchant-links.ts';

test('the plain dashboard link opens the page for its kind', () => {
  assert.equal(merchantPageForNotification('/merchantDashboard', 'new_order'), '/sales');
  assert.equal(merchantPageForNotification('/merchantDashboard', 'chat_message'), '/sales');
  assert.equal(merchantPageForNotification('/merchantDashboard', 'review_received'), '/reviews');
  assert.equal(merchantPageForNotification('/merchantDashboard', 'payout_released'), '/earnings');
  assert.equal(merchantPageForNotification('/merchantDashboard/', 'payout_destination_changed'), '/earnings');
});

test('an unknown kind opens the dashboard', () => {
  assert.equal(merchantPageForNotification('/merchantDashboard', 'something_new'), '/');
});

test('other links are not changed here', () => {
  for (const link of [null, undefined, '', '/orders/5', '/admin/orders', '/merchantDashboard/routing/3', '/merchantDashboards']) {
    assert.equal(merchantPageForNotification(link, 'new_order'), null, String(link));
  }
});
