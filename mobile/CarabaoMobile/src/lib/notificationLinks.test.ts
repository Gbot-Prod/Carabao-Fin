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
  assert.deepEqual(appRoute('/merchantDashboard?tab=orders'), { merchant: undefined });
  assert.equal(appRoute(null), null);
  assert.equal(appRoute('/admin/refunds'), null);
  assert.equal(appRoute('https://evil.example/orders/1'), null);
});

test('a chat message opens that order chat', () => {
  const chat = { pathname: '/order-chat', params: { orderId: '12' } };
  assert.deepEqual(appRoute('/chats?order=12', 'chat_message'), chat);
  assert.deepEqual(appRoute('/orders/12', 'chat_message'), chat); // older buyer notifications
  assert.equal(appRoute('/chats?farm=4', 'chat_message'), null);
  // A bad id is not opened.
  assert.equal(appRoute('/chats?order=1e3', 'chat_message'), null);
});

test('merchant notifications hand off to the merchant app (CF-0125)', () => {
  // The buyer app has no merchant screens left, so every kind goes over as it came.
  assert.deepEqual(appRoute('/merchantDashboard', 'chat_message'), { merchant: 'chat_message' });
  assert.deepEqual(appRoute('/merchantDashboard?inquiry=3', 'chat_message'), { merchant: 'chat_message' });
  // The chat for one of the farm's orders is the merchant app's too.
  assert.deepEqual(appRoute('/merchantDashboard?order=12', 'chat_message'), { merchant: 'chat_message' });
  assert.deepEqual(appRoute('/merchantDashboard?order=12', 'new_order'), { merchant: 'new_order' });
  assert.deepEqual(appRoute('/merchantDashboard', 'review_received'), { merchant: 'review_received' });
});
