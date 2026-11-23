/// <reference types="node" />
// Merchant copy of mobile/CarabaoMobile/src/lib/notificationLinks.test.ts - the merchant
// cases only (plan §4.5). Run with `npm test`. CF-0105 / CF-0121.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appRoute, isMerchantNotification } from './notificationLinks.ts';

test('a new order opens the Orders tab', () => {
  assert.deepEqual(appRoute('/merchantDashboard', 'new_order'), { pathname: '/(tabs)/orders' });
  assert.deepEqual(appRoute('/merchantDashboard?tab=orders', 'new_order'), { pathname: '/(tabs)/orders' });
});

test('a review opens the farm’s reviews', () => {
  assert.deepEqual(appRoute('/merchantDashboard', 'review_received'), { pathname: '/reviews' });
  assert.deepEqual(appRoute('/merchantDashboard?tab=reviews', 'review_received'), { pathname: '/reviews' });
});

test('a chat message opens that order chat, else the chat list', () => {
  const chat = { pathname: '/order-chat', params: { orderId: '12' } };
  assert.deepEqual(appRoute('/merchantDashboard?order=12', 'chat_message'), chat);
  assert.deepEqual(appRoute('/merchantDashboard?tab=chats&order=12', 'chat_message'), chat);
  // A farm question has no order to open.
  assert.deepEqual(appRoute('/merchantDashboard?inquiry=3', 'chat_message'), { pathname: '/(tabs)/chats' });
  assert.deepEqual(appRoute('/merchantDashboard', 'chat_message'), { pathname: '/(tabs)/chats' });
});

test('a bad order id opens the chat list, never a chat', () => {
  const links = [
    '/merchantDashboard?order=abc',
    '/merchantDashboard?order=0',
    '/merchantDashboard?order=1e3',
    '/merchantDashboard?order=42/../7',
    '/merchantDashboard?order=success',
    '/merchantDashboard?order=',
  ];
  for (const link of links) {
    assert.deepEqual(appRoute(link, 'chat_message'), { pathname: '/(tabs)/chats' }, link);
  }
});

test('a payout, an unknown kind and a link without a kind open the dashboard', () => {
  // Earnings is Plan 2; the web bell opens /earnings for both payout kinds.
  assert.deepEqual(appRoute('/merchantDashboard', 'payout_released'), { pathname: '/(tabs)' });
  assert.deepEqual(appRoute('/merchantDashboard', 'payout_destination_changed'), { pathname: '/(tabs)' });
  assert.deepEqual(appRoute('/merchantDashboard', 'stock_low'), { pathname: '/(tabs)' });
  assert.deepEqual(appRoute('/merchantDashboard'), { pathname: '/(tabs)' });
});

test('buyer links open nothing in this app', () => {
  // The merchant account can hold buyer notifications too; the buyer app owns them.
  for (const link of ['/track', '/orders', '/orders/42', '/chats?order=12', '/admin/refunds', '/somewhere']) {
    assert.equal(appRoute(link, 'new_order'), null, link);
    assert.equal(appRoute(link, 'chat_message'), null, link);
    assert.equal(isMerchantNotification(link), false, link);
  }
  assert.equal(appRoute(null), null);
  assert.equal(appRoute(null, 'chat_message'), null);
  assert.equal(appRoute('https://evil.example/merchantDashboard'), null);
});

test('only /merchantDashboard links are the farm’s notifications', () => {
  assert.equal(isMerchantNotification('/merchantDashboard'), true);
  assert.equal(isMerchantNotification('/merchantDashboard?order=12'), true);
  assert.equal(isMerchantNotification('/merchantDashboard#top'), true);
  // The backend writes these links; a prefix match is enough, as the buyer app does.
  assert.equal(isMerchantNotification('/merchantDashboard/anything'), true);
  assert.equal(isMerchantNotification(null), false);
  assert.equal(isMerchantNotification(''), false);
  assert.equal(isMerchantNotification('https://carabao.online/merchantDashboard'), false);
});
