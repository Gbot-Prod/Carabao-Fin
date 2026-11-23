/// <reference types="node" />
// Run with `npm test`. CF-0127.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inboxChatTitle, preview, sinceLabel, sortInbox, totalUnread, type ChatSummary } from './chatInbox.ts';
import { chatTitle } from './orderChat.ts';

const row = (id: number, over: Partial<ChatSummary> = {}): ChatSummary => ({
  order_id: id, order_ref: `CB-2026-${String(id).padStart(4, '0')}`, order_status: 'processing', buyer_name: 'Ana',
  closed: false, last_body: 'hi', last_sender_role: 'buyer', last_mine: false, last_at: '2026-11-19T00:00:00Z', unread: 0, ...over,
});

test('unread first, then open before closed, then newest', () => {
  const rows = [
    row(1, { last_at: '2026-11-19T05:00:00Z' }),
    row(2, { unread: 2, last_at: '2026-11-18T00:00:00Z' }),
    row(3, { closed: true, last_at: '2026-11-19T09:00:00Z' }),
    row(4, { last_at: '2026-11-19T07:00:00Z' }),
  ];
  assert.deepEqual(sortInbox(rows).map((r) => r.order_id), [2, 4, 1, 3]);
  assert.equal(totalUnread(rows), 2);
});

test('preview: one line, cut, "You:" for my last message', () => {
  assert.equal(preview({ last_body: 'Is it\nfresh?', last_mine: false }), 'Is it fresh?');
  assert.equal(preview({ last_body: 'Thanks', last_mine: true }), 'You: Thanks');
  assert.equal(preview({ last_body: 'x'.repeat(100), last_mine: false }, 10), `${'x'.repeat(9)}…`);
});

test('since label', () => {
  const now = Date.parse('2026-11-19T12:00:00Z');
  assert.equal(sinceLabel('2026-11-19T11:59:30Z', now), 'now');
  assert.equal(sinceLabel('2026-11-19T11:55:00Z', now), '5 min');
  assert.equal(sinceLabel('2026-11-19T09:00:00Z', now), '3 h');
  assert.equal(sinceLabel('2026-11-17T12:00:00Z', now), '2 d');
  assert.equal(sinceLabel('2026-10-01T00:00:00Z', now), '2026-10-01');
  assert.equal(sinceLabel('bad', now), '');
});

test('the title passes the chat screen check (CF-0114)', () => {
  assert.equal(chatTitle(inboxChatTitle(row(5)), false, 5), 'Chat with Ana');
  assert.equal(chatTitle(inboxChatTitle(row(5, { buyer_name: null })), false, 5), 'Chat with buyer of CB-2026-0005');
  assert.equal(chatTitle(inboxChatTitle(row(5, { buyer_name: 'A\nB' })), false, 5), 'Chat with A B');
});
