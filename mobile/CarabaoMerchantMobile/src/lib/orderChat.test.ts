// Merchant copy of mobile/CarabaoMobile/src/lib/orderDetail.test.ts (the chat tests only).
/// <reference types="node" />
// Run with `npm test`. CF-0105, S5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatEndpoint, chatTarget, chatTitle, parseOrderId } from './orderChat.ts';

test('chat title: only the form the app sends; never a fake support header', () => {
  assert.equal(chatTitle('Chat with Dela Cruz Farm', { kind: 'order', orderId: 7 }), 'Chat with Dela Cruz Farm');
  assert.equal(chatTitle('Chat with Carabao Support', { kind: 'order', orderId: 7 }), 'Order #7');
  assert.equal(chatTitle('Your account is locked, call 0917…', { kind: 'order', orderId: 7 }), 'Order #7');
  assert.equal(chatTitle(`Chat with ${'x'.repeat(81)}`, { kind: 'order', orderId: 7 }), 'Order #7');
  assert.equal(chatTitle('Chat with A\nB', null), 'Chat');
  assert.equal(chatTitle(undefined, { kind: 'support' }), 'Carabao support');
  assert.equal(chatTitle(undefined, null), 'Chat');
  // S5: a question has no order number, so it falls back to the web's tag.
  assert.equal(chatTitle(undefined, { kind: 'inquiry', conversationId: 3 }), 'Question before buying');
});

test('the route picks the thread: support, then inquiry, then order', () => {
  assert.deepEqual(chatTarget(undefined, undefined, true), { kind: 'support' });
  // S5: `inquiry=<conversation_id>` is the Chats tab's question row.
  assert.deepEqual(chatTarget('7', '3', false), { kind: 'inquiry', conversationId: 3 });
  assert.deepEqual(chatTarget('7', undefined, false), { kind: 'order', orderId: 7 });
  assert.equal(chatTarget(undefined, undefined, false), null);
  assert.deepEqual(chatTarget('7', 'abc', false), { kind: 'order', orderId: 7 });
  // Only a plain id reaches a URL (CF-0114): a bad value is ignored, never repaired.
  assert.equal(chatTarget('7/../x', '3/../x', false), null);
  assert.equal(chatTarget(['7'], ['3'], false), null);
});

test('each thread has the web endpoint (merchants.ts inquiryEndpoint, OrderChat url)', () => {
  assert.equal(chatEndpoint({ kind: 'support' }), '/support/messages');
  assert.equal(chatEndpoint({ kind: 'order', orderId: 7 }), '/orders/7/messages');
  assert.equal(chatEndpoint({ kind: 'inquiry', conversationId: 3 }), '/inquiries/3/messages');
});

test('order id parameter: plain positive whole numbers only', () => {
  assert.equal(parseOrderId('42'), 42);
  assert.equal(parseOrderId('1'), 1);
  for (const bad of [undefined, '', '0', '-1', '01', ' 7', '7 ', '1e3', '0x10', '3.5', '7/../x', 'abc', '12345678901']) {
    assert.equal(parseOrderId(bad), null, String(bad));
  }
  assert.equal(parseOrderId(['42']), null);
});
