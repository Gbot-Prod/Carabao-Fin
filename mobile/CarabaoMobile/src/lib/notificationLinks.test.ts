/// <reference types="node" />
// Run with `npm test`. CF-0105.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appRoute } from './notificationLinks.ts';

test('an order link opens that order', () => {
  assert.deepEqual(appRoute('/orders/42'), { pathname: '/order-detail', params: { orderId: '42' } });
  assert.deepEqual(appRoute('/orders/42/'), { pathname: '/order-detail', params: { orderId: '42' } });
  assert.deepEqual(appRoute('/orders/42?tab=chat'), { pathname: '/order-detail', params: { orderId: '42' } });
});

test('a bad order id falls back to the history list', () => {
  for (const link of ['/orders/abc', '/orders/0', '/orders/1e3', '/orders/42/../7', '/orders/success']) {
    assert.deepEqual(appRoute(link), { pathname: '/(tabs)/history' }, link);
  }
  assert.deepEqual(appRoute('/orders'), { pathname: '/(tabs)/history' });
});

test('other links keep their old targets, unknown links open nothing', () => {
  assert.deepEqual(appRoute('/track'), { pathname: '/(tabs)/track' });
  assert.deepEqual(appRoute('/merchantDashboard?tab=orders'), { pathname: '/merchant-orders' });
  assert.equal(appRoute(null), null);
  assert.equal(appRoute('/admin/refunds'), null);
  assert.equal(appRoute('https://evil.example/orders/1'), null);
});
