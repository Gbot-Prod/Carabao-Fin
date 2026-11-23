// Merchant copy of mobile/CarabaoMobile/src/lib/orderDetail.test.ts (the chat tests only).
/// <reference types="node" />
// Run with `npm test`. CF-0105.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatTitle, parseOrderId } from './orderChat.ts';

test('chat title: only the form the app sends; never a fake support header', () => {
  assert.equal(chatTitle('Chat with Dela Cruz Farm', false, 7), 'Chat with Dela Cruz Farm');
  assert.equal(chatTitle('Chat with Carabao Support', false, 7), 'Order #7');
  assert.equal(chatTitle('Your account is locked, call 0917…', false, 7), 'Order #7');
  assert.equal(chatTitle(`Chat with ${'x'.repeat(81)}`, false, 7), 'Order #7');
  assert.equal(chatTitle('Chat with A\nB', false, null), 'Order chat');
  assert.equal(chatTitle(undefined, true, null), 'Carabao support');
});

test('order id parameter: plain positive whole numbers only', () => {
  assert.equal(parseOrderId('42'), 42);
  assert.equal(parseOrderId('1'), 1);
  for (const bad of [undefined, '', '0', '-1', '01', ' 7', '7 ', '1e3', '0x10', '3.5', '7/../x', 'abc', '12345678901']) {
    assert.equal(parseOrderId(bad), null, String(bad));
  }
  assert.equal(parseOrderId(['42']), null);
});
