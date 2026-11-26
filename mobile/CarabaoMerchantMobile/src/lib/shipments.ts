// src/lib/shipments.ts
// S11 (plan §5.4, part 1): the pure half of the Shipments screen. Which orders are ready to
// ship, the 20-order cap and the words that come with it, the web's ready groups, and the
// notes a created shipment prints for the stops it had to leave out. Everything here is
// copied from the web merchant app (`M/(shell)/shipments/page.tsx`,
// `M/components/ShipmentsTab.tsx`, `M/hooks/useShipmentSelection.ts`), so a farm reads the
// same words on the phone as on the website. `npm test` checks these
// (src/lib/shipments.test.ts), and inStep.test.ts keeps the cap, the reasons and the labels
// in step with the backend and the web.
import type {
  ApiMerchantOrder,
  MerchantShipmentSkip,
  MerchantShipmentSummary,
  MerchantShipmentTracking,
  ShipmentSkipReason,
} from './api.ts';

/** Same as MAX_SHIPMENT_ORDERS in backend/app/schemas/shipment.py and W/util/api/merchants.ts. */
export const MAX_SHIPMENT_ORDERS = 20;

// ── The screen's words ────────────────────────────────────────────────────────

/** The web shipments page description and its "{n} ready" count. */
export const SHIPMENTS_LEAD = 'Put paid orders on one delivery route. One pickup, many drops.';
export const readyCountLabel = (count: number) => `${count} ready`;

export const READY_TO_SHIP_TITLE = 'Ready to ship';
/** The web section hint, with the same cap in it (ShipmentsTab.tsx). */
export const READY_TO_SHIP_HINT =
  `Paid, confirmed orders not yet on a route. Pick up to ${MAX_SHIPMENT_ORDERS} for one run; ` +
  'the stop order is computed for you.';

export const NOTHING_TO_SHIP = 'Nothing waiting to ship.';
export const GO_TO_ORDERS = 'Go to Orders';

export const ACTIVE_SHIPMENTS_TITLE = 'Active shipments';
export const COMPLETED_SHIPMENTS_TITLE = 'Completed shipments';
export const NO_SHIPMENTS = 'No shipments on the road.';
export const SHIPMENTS_LOAD_ERROR = 'Failed to load shipments.';
export const SHIPMENT_CREATE_ERROR = 'Could not create shipment.';
/** The web row's button (`t.routing.routingButton`) and the success link (`openRouting`). */
export const ROUTING_LABEL = 'Routing';
export const OPEN_ROUTE_LABEL = 'Open routing →';
/** Plan §5.4 words the action "Make route"; the web's button says "Create shipment". */
export const MAKE_ROUTE_LABEL = 'Make route';
export const MAKING_ROUTE_LABEL = 'Making route…';
export const CLEAR_LABEL = 'Clear';
/** The web's per-row words (ShipmentsTab.tsx ReadyGroup). */
export const NO_ADDRESS = 'No address';
export const itemsLabel = (count: number) => `${count} item${count === 1 ? '' : 's'}`;
export const selectAllLabel = (count: number, label: string) =>
  `Select all ${count} orders: ${label}`;
export const stopsCompletedLabel = (done: number, total: number) =>
  `${done} of ${total} stops completed`;
/** The web shows 10 finished shipments at a time (PAST_PAGE). */
export const PAST_PAGE = 10;
export const showMoreLabel = (left: number) => `Show more (${left} left)`;
export const stopsLabel = (done: number, total: number) => `${done} / ${total} stops`;
export const progressPercent = (done: number, total: number) =>
  total > 0 ? Math.round((done / total) * 100) : 0;

/** The web's sticky action bar count ("3 / 20 selected"). */
export const selectionCountLabel = (count: number) =>
  `${count} / ${MAX_SHIPMENT_ORDERS} selected`;
/**
 * A clear message for the cap: the web only disables the 21st checkbox, which on a phone
 * looks broken, so a refused pick says why (plan §5.4 "cap at 20 with a clear message").
 */
export const SELECTION_FULL_MESSAGE =
  `One route takes at most ${MAX_SHIPMENT_ORDERS} orders. Take one off to add another.`;
/** The web's note under the stops a shipment had to leave out. */
export const SKIPPED_KEPT_NOTE =
  'They stay in Ready to ship; message the buyer to check their pin.';

// ── Ready to ship ─────────────────────────────────────────────────────────────

// Ready to ship: paid and confirmed, and not already on a route. Same as
// SHIPPABLE_ORDER_STATUSES in backend/app/api/routes/shipments.py and isReadyToShip in
// M/hooks/useMerchantOrders.ts (src/lib/badges.ts builds its counts on this list).
export const READY_TO_SHIP_STATUS: ApiMerchantOrder['status'] = 'processing';

/** The orders the screen offers a checkbox for, in the context's order. */
export function readyToShipOrders<
  T extends Pick<ApiMerchantOrder, 'status' | 'shipped' | 'shipment_id'>,
>(orders: readonly T[]): T[] {
  return orders.filter(
    (o) => o.status === READY_TO_SHIP_STATUS && !o.shipped && o.shipment_id == null,
  );
}

/** The web's one ready group label (ShipmentsTab.tsx): the farm decides when to deliver. */
export const READY_GROUP_LABEL = 'Oldest order first';

/** The web's oldestFirst: the older order first, then the lower id. */
export function oldestFirst(
  a: Pick<ApiMerchantOrder, 'id' | 'ordered_at'>,
  b: Pick<ApiMerchantOrder, 'id' | 'ordered_at'>,
): number {
  return a.ordered_at.localeCompare(b.ordered_at) || a.id - b.id;
}

export type ReadyGroup = {
  key: 'all';
  label: string;
  urgent: boolean;
  orders: ApiMerchantOrder[];
};

/** The ready orders as the web draws them: one group, oldest first; none when empty. */
export function readyGroups(orders: readonly ApiMerchantOrder[]): ReadyGroup[] {
  if (orders.length === 0) return [];
  return [{ key: 'all', label: READY_GROUP_LABEL, urgent: false, orders: [...orders].sort(oldestFirst) }];
}

// ── Selection ─────────────────────────────────────────────────────────────────

export type SelectionChange = {
  /** The selection after the change; ids that stopped being ready are gone. */
  selected: Set<number>;
  /** How many picks the cap refused (0 when every pick was taken). */
  refused: number;
};

/**
 * The web's useShipmentSelection setSelected: ids that stopped being shippable (cancelled,
 * shipped, already on a route) drop out and never count toward the cap, and adding stops at
 * the cap instead of going over it.
 */
export function applySelection(
  selected: ReadonlySet<number>,
  readyIds: ReadonlySet<number>,
  ids: readonly number[],
  select: boolean,
): SelectionChange {
  const next = new Set([...selected].filter((id) => readyIds.has(id)));
  let refused = 0;
  for (const id of ids) {
    if (!select) next.delete(id);
    else if (!readyIds.has(id)) continue;
    else if (next.size < MAX_SHIPMENT_ORDERS) next.add(id);
    else refused += 1;
  }
  return { selected: next, refused };
}

/** One checkbox: select it, or take it off. */
export function toggleOrder(
  selected: ReadonlySet<number>,
  readyIds: ReadonlySet<number>,
  id: number,
): SelectionChange {
  return applySelection(selected, readyIds, [id], !selected.has(id));
}

/** The ids the create call posts. */
export const selectedIds = (selected: ReadonlySet<number>) => [...selected];

// ── A created shipment ────────────────────────────────────────────────────────

/**
 * The web's words for each reason a stop was left out (ShipmentsTab.tsx handleCreate); the
 * sentence it builds is "Left out #3: <this>".
 */
export const SKIP_REASON_TEXT: Record<ShipmentSkipReason, string> = {
  no_location: 'the delivery location could not be found on the map.',
  no_road: 'no road route reaches it.',
};

export type SkipNote = { reason: ShipmentSkipReason; ids: number[]; text: string };

/**
 * One line per reason, in the web's order and with its words, for the stops the server could
 * not route: "Left out #3, #7: no road route reaches it."
 */
export function skipNotes(skipped: readonly MerchantShipmentSkip[]): SkipNote[] {
  const notes: SkipNote[] = [];
  for (const reason of Object.keys(SKIP_REASON_TEXT) as ShipmentSkipReason[]) {
    const ids = skipped.filter((s) => s.reason === reason).map((s) => s.order_id);
    if (ids.length > 0) {
      notes.push({
        reason,
        ids,
        text: `Left out ${ids.map((id) => `#${id}`).join(', ')}: ${SKIP_REASON_TEXT[reason]}`,
      });
    }
  }
  return notes;
}

/** "Shipment #12 created with 3 stops." - the web's success line (order_ids are the stops). */
export function createdSummary(
  tracking: Pick<MerchantShipmentTracking, 'shipment_id' | 'order_ids'>,
): string {
  const stops = tracking.order_ids.length;
  return `Shipment #${tracking.shipment_id} created with ${stops} stop${stops === 1 ? '' : 's'}.`;
}

// ── The shipment list ─────────────────────────────────────────────────────────

/** A shipment still on the road: the web's `completed_stop_count < stop_count`. */
export function isActiveShipment(
  shipment: Pick<MerchantShipmentSummary, 'stop_count' | 'completed_stop_count'>,
): boolean {
  return shipment.completed_stop_count < shipment.stop_count;
}

/** The web's two sections; the server sends newest first and both keep that order. */
export function splitShipments(shipments: readonly MerchantShipmentSummary[]): {
  active: MerchantShipmentSummary[];
  past: MerchantShipmentSummary[];
} {
  return {
    active: shipments.filter(isActiveShipment),
    past: shipments.filter((s) => !isActiveShipment(s)),
  };
}


