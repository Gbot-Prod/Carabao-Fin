// src/lib/shipments.test.ts
// S11: the Shipments screen's pure rules - the ready list, the 20-order cap, the web's ready
// groups and the notes a created shipment prints. Run with `npm test`.
/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SHIPMENT_ORDERS,
  PAST_PAGE,
  SELECTION_FULL_MESSAGE,
  SKIP_REASON_TEXT,
  applySelection,
  createdSummary,
  isActiveShipment,
  progressPercent,
  readyGroupOf,
  readyGroups,
  readyToShipOrders,
  selectedIds,
  selectionCountLabel,
  showMoreLabel,
  skipNotes,
  splitShipments,
  stopsLabel,
  toggleOrder,
} from './shipments.ts';
import type { ApiMerchantOrder, MerchantShipmentSummary } from './api.ts';

/** The fields these rules read; the rest of ApiMerchantOrder is not needed here. */
const order = (id: number, patch: Record<string, unknown> = {}) =>
  ({
    id,
    status: 'processing',
    shipped: false,
    shipment_id: null,
    requested_delivery_date: null,
    delivery_window: null,
    ...patch,
  }) as unknown as ApiMerchantOrder;

const ids = (orders: readonly ApiMerchantOrder[]) => orders.map((o) => o.id);

test('ready to ship is paid and confirmed, and not already on a route', () => {
  const orders = [
    order(1),
    order(2, { status: 'pending' }),
    order(3, { status: 'delivered' }),
    order(4, { shipped: true }),
    order(5, { shipment_id: 9 }),
    order(6, { status: 'cancelled' }),
  ];
  assert.deepEqual(ids(readyToShipOrders(orders)), [1]);
  assert.deepEqual(ids(readyToShipOrders([])), []);
});

test('the cap is 20, and the 21st pick is refused with a message that says so', () => {
  assert.equal(MAX_SHIPMENT_ORDERS, 20);
  const ready = new Set(Array.from({ length: 25 }, (_, i) => i + 1));

  const twenty = applySelection(new Set<number>(), ready, [...ready].slice(0, 20), true);
  assert.equal(twenty.selected.size, MAX_SHIPMENT_ORDERS);
  assert.equal(twenty.refused, 0);

  // The 21st checkbox: nothing is added, and the change reports the refusal.
  const refused = toggleOrder(twenty.selected, ready, 21);
  assert.equal(refused.selected.size, MAX_SHIPMENT_ORDERS);
  assert.equal(refused.refused, 1);
  assert.ok(!refused.selected.has(21));
  assert.match(SELECTION_FULL_MESSAGE, /at most 20 orders/);

  // Taking one off makes room for the one that was refused.
  const off = toggleOrder(refused.selected, ready, 1);
  assert.equal(off.selected.size, 19);
  const again = toggleOrder(off.selected, ready, 21);
  assert.equal(again.selected.size, MAX_SHIPMENT_ORDERS);
  assert.ok(again.selected.has(21));
});

test('a selection forgets orders that stopped being ready, and never counts them', () => {
  const ready = new Set([1, 2]);
  const stale = new Set([1, 2, 3]);
  // Order 3 shipped elsewhere, so the count is what is still ready.
  assert.equal(selectionCountLabel(applySelection(stale, ready, [], true).selected.size), '2 / 20 selected');
  // A select-all over 20+ rows stops at the cap and says how many it refused.
  const many = new Set(Array.from({ length: 22 }, (_, i) => i + 1));
  const all = applySelection(new Set<number>(), many, [...many], true);
  assert.equal(all.selected.size, MAX_SHIPMENT_ORDERS);
  assert.equal(all.refused, 2);
  assert.deepEqual(selectedIds(all.selected).length, MAX_SHIPMENT_ORDERS);
  // An id that is not ready cannot be added, and the stale row 3 drops out of the selection.
  assert.deepEqual(selectedIds(applySelection(stale, ready, [], true).selected), [1, 2]);
  assert.equal(applySelection(new Set<number>(), ready, [3], true).selected.size, 0);
});

test('the ready groups are the web\'s, soonest first with undated orders last', () => {
  const today = '2026-11-24';
  assert.equal(readyGroupOf(order(1, { requested_delivery_date: '2026-11-20' }), today), 'overdue');
  assert.equal(readyGroupOf(order(1, { requested_delivery_date: today }), today), 'today');
  assert.equal(readyGroupOf(order(1, { requested_delivery_date: '2026-11-25' }), today), 'tomorrow');
  assert.equal(readyGroupOf(order(1, { requested_delivery_date: '2026-12-30' }), today), 'later');
  assert.equal(readyGroupOf(order(1), today), 'none');

  const groups = readyGroups(
    [
      order(9),
      order(4, { requested_delivery_date: '2026-11-24', delivery_window: 'PM' }),
      order(3, { requested_delivery_date: '2026-11-24', delivery_window: 'AM' }),
      order(2, { requested_delivery_date: '2026-11-20' }),
      order(5, { requested_delivery_date: '2026-11-25' }),
      order(7, { requested_delivery_date: '2026-12-30' }),
    ],
    today,
  );
  assert.deepEqual(groups.map((g) => g.label), [
    'Past requested date',
    'Deliver today',
    'Deliver tomorrow',
    'Later',
    'No date requested',
  ]);
  assert.deepEqual(groups.map((g) => g.urgent), [true, true, false, false, false]);
  // Today's two are ordered by delivery window, not by id.
  assert.deepEqual(ids(groups[1].orders), [3, 4]);
  // Empty groups are dropped.
  assert.deepEqual(readyGroups([order(1, { requested_delivery_date: today })], today).map((g) => g.key), ['today']);
  assert.deepEqual(readyGroups([], today), []);
});

test('the stops a shipment left out are named with the web\'s words', () => {
  assert.deepEqual(Object.keys(SKIP_REASON_TEXT), ['no_location', 'no_road']);
  assert.equal(SKIP_REASON_TEXT.no_location, 'the delivery location could not be found on the map.');
  assert.equal(SKIP_REASON_TEXT.no_road, 'no road route reaches it.');

  const notes = skipNotes([
    { order_id: 7, reason: 'no_road' },
    { order_id: 3, reason: 'no_location' },
    { order_id: 9, reason: 'no_road' },
  ]);
  // One line per reason, in the web's order (location first), ids in the server's order.
  assert.deepEqual(notes.map((n) => n.reason), ['no_location', 'no_road']);
  assert.deepEqual(notes[0].ids, [3]);
  assert.equal(notes[0].text, 'Left out #3: the delivery location could not be found on the map.');
  assert.deepEqual(notes[1].ids, [7, 9]);
  assert.equal(notes[1].text, 'Left out #7, #9: no road route reaches it.');

  assert.deepEqual(skipNotes([]), []);
  // A shipment that routed every stop still says how many it made.
  assert.equal(createdSummary({ shipment_id: 12, order_ids: [3] }), 'Shipment #12 created with 1 stop.');
  assert.equal(createdSummary({ shipment_id: 12, order_ids: [3, 4, 5] }), 'Shipment #12 created with 3 stops.');
  assert.equal(createdSummary({ shipment_id: 12, order_ids: [] }), 'Shipment #12 created with 0 stops.');
});

test('the shipment list splits on the road from finished, with the web\'s counts', () => {
  const shipment = (id: number, stop_count: number, completed_stop_count: number) =>
    ({
      id,
      status: 'in_transit',
      stop_count,
      completed_stop_count,
      created_at: '2026-11-24T08:00:00Z',
      shipped_at: null,
    }) as MerchantShipmentSummary;

  const list = [shipment(3, 2, 0), shipment(2, 3, 3), shipment(1, 1, 0), shipment(0, 4, 4)];
  assert.equal(isActiveShipment(list[0]), true);
  assert.equal(isActiveShipment(list[1]), false);
  assert.deepEqual(splitShipments(list).active.map((s) => s.id), [3, 1]);
  assert.deepEqual(splitShipments(list).past.map((s) => s.id), [2, 0]);
  assert.deepEqual(splitShipments([]), { active: [], past: [] });

  assert.equal(PAST_PAGE, 10);
  assert.equal(showMoreLabel(4), 'Show more (4 left)');
  assert.equal(stopsLabel(1, 3), '1 / 3 stops');
  assert.equal(progressPercent(1, 3), 33);
  assert.equal(progressPercent(0, 0), 0);
  assert.equal(progressPercent(3, 3), 100);
});

