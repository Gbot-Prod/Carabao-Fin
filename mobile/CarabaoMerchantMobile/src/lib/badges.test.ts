/// <reference types="node" />
// S3 (plan §4): the tab-bar and More-row counts. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_ORDER_STATUSES,
  READY_TO_SHIP_STATUS,
  activeOrderCount,
  productCount,
  readyToShipCount,
  unreadChatCount,
} from './badges.ts';
import type { ApiMerchantOrder } from './api.ts';

const order = (
  status: ApiMerchantOrder['status'],
  shipped = false,
  shipment_id: number | null = null,
): ApiMerchantOrder => ({ status, shipped, shipment_id } as ApiMerchantOrder);

test('the active statuses are pending, processing, shipped and out_for_delivery', () => {
  assert.deepEqual(
    [...ACTIVE_ORDER_STATUSES],
    ['pending', 'processing', 'shipped', 'out_for_delivery'],
  );
  assert.equal(READY_TO_SHIP_STATUS, 'processing');
});

test('activeOrderCount counts the orders still being worked on', () => {
  const orders = [
    order('pending'),
    order('processing'),
    order('shipped', true),
    order('out_for_delivery', true),
    order('delivered', true),
    order('cancelled'),
  ];
  assert.equal(activeOrderCount(orders), 4);
  assert.equal(activeOrderCount([]), 0);
});

test('readyToShipCount: processing, not shipped and not on a route yet', () => {
  const orders = [
    order('processing'),
    order('processing', false, 7),
    order('processing', true),
    order('pending'),
    order('shipped', true),
  ];
  assert.equal(readyToShipCount(orders), 1);
  assert.equal(readyToShipCount([]), 0);
});

test('unreadChatCount counts chats and questions, not messages', () => {
  const chats = [{ unread: 0 }, { unread: 3 }, { unread: 1 }];
  const inquiries = [{ unread: 0 }, { unread: 2 }];
  assert.equal(unreadChatCount(chats), 2);
  // S5: the Chats badge is the web's count — order chats + questions with an unread row.
  assert.equal(unreadChatCount(chats, inquiries), 3);
  assert.equal(unreadChatCount([], inquiries), 1);
  assert.equal(unreadChatCount([], []), 0);
});

test('productCount is the number of listings', () => {
  assert.equal(productCount([]), 0);
  assert.equal(productCount([{ id: 1 }, { id: 2 }, { id: 3 }]), 3);
});
