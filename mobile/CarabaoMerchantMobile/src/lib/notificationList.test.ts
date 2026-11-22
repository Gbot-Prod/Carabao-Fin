// Merchant copy of mobile/CarabaoMobile/src/lib/notificationList.test.ts.
// The last test (M50) is left out: it checks the buyer notificationLinks routes, and the
// merchant app maps notification links of its own (S12). sharedCopies.test.ts skips this file.
/// <reference types="node" />
// Run with `npm test`. CF-0121.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyNoteAction, notesQuery, unreadAfter, type Note } from './notificationList.ts';

const n = (id: number, read: boolean): Note => ({ id, kind: 'order_paid', title: 't', body: null, link: null, read, created_at: '' });
const list = [n(1, false), n(2, true), n(3, false)];

test('query: paging and the unread filter', () => {
  assert.equal(notesQuery(false, 0), 'limit=30&offset=0&unread_only=false');
  assert.equal(notesQuery(true, 60, 10), 'limit=10&offset=60&unread_only=true');
  assert.equal(notesQuery(true, -5), 'limit=30&offset=0&unread_only=true');
});

test('local changes match what the server will return', () => {
  assert.deepEqual(applyNoteAction(list, { type: 'read', id: 1 }, false).map((x) => x.read), [true, true, false]);
  assert.deepEqual(applyNoteAction(list, { type: 'read', id: 1 }, true).map((x) => x.id), [2, 3]); // leaves the Unread view
  assert.deepEqual(applyNoteAction(list, { type: 'unread', id: 2 }, false).map((x) => x.read), [false, false, false]);
  assert.deepEqual(applyNoteAction(list, { type: 'delete', id: 3 }, false).map((x) => x.id), [1, 2]);
  assert.deepEqual(applyNoteAction(list, { type: 'readAll' }, false).every((x) => x.read), true);
  assert.deepEqual(applyNoteAction(list, { type: 'readAll' }, true), []);
  assert.deepEqual(applyNoteAction(list, { type: 'deleteRead' }, false).map((x) => x.id), [1, 3]);
});

test('unread count follows the change and never goes below zero', () => {
  assert.equal(unreadAfter(2, list, { type: 'read', id: 1 }), 1);
  assert.equal(unreadAfter(2, list, { type: 'read', id: 2 }), 2); // was already read
  assert.equal(unreadAfter(2, list, { type: 'unread', id: 2 }), 3);
  assert.equal(unreadAfter(2, list, { type: 'delete', id: 3 }), 1);
  assert.equal(unreadAfter(2, list, { type: 'delete', id: 2 }), 2);
  assert.equal(unreadAfter(0, list, { type: 'read', id: 1 }), 0);
  assert.equal(unreadAfter(5, list, { type: 'readAll' }), 0);
});
