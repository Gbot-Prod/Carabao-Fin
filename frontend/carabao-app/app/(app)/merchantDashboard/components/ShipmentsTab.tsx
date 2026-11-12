import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import styles from "../page.module.css";
import s from "./orders.module.css";
import PageLoader from "@/components/PageLoader/PageLoader";
import {
  createMerchantShipment,
  fetchMyShipments,
  MAX_SHIPMENT_ORDERS,
  type MerchantOrder,
  type MerchantShipmentSummary,
} from "@/util/api";
import getApiErrorMessage from "@/util/errorHelper";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { addDays, formatPeso, formatRequestedDate, todayInManila } from "../lib/format";
import type { MerchantOrdersState } from "../hooks/useMerchantOrders";
import type { ShipmentSelection } from "../hooks/useShipmentSelection";

type GroupKey = "overdue" | "today" | "tomorrow" | "later" | "none";

const GROUPS: { key: GroupKey; label: string }[] = [
  { key: "overdue", label: "Past requested date" },
  { key: "today", label: "Deliver today" },
  { key: "tomorrow", label: "Deliver tomorrow" },
  { key: "later", label: "Later" },
  { key: "none", label: "No date requested" },
];

const groupOf = (order: MerchantOrder, today: string): GroupKey => {
  const date = order.requested_delivery_date;
  if (!date) return "none";
  if (date < today) return "overdue";
  if (date === today) return "today";
  if (date === addDays(today, 1)) return "tomorrow";
  return "later";
};

const bySchedule = (a: MerchantOrder, b: MerchantOrder) =>
  (a.requested_delivery_date ?? "").localeCompare(b.requested_delivery_date ?? "") ||
  (a.delivery_window ?? "").localeCompare(b.delivery_window ?? "") ||
  a.id - b.id;

const PAST_PAGE = 10;

type Message = { type: "success" | "error"; text: string; shipmentId?: number };

type Props = {
  ordersState: MerchantOrdersState;
  selection: ShipmentSelection;
  onOpenOrders: () => void;
};

export default function ShipmentsTab({ ordersState, selection, onOpenOrders }: Props) {
  const { t } = useLanguage();
  const { readyToShip, loaded, loading, error, reload } = ordersState;
  const today = useMemo(() => todayInManila(), []);

  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const [shipments, setShipments] = useState<MerchantShipmentSummary[]>([]);
  const [shipmentsLoading, setShipmentsLoading] = useState(false);
  const [shipmentsError, setShipmentsError] = useState<string | null>(null);
  const [pastShown, setPastShown] = useState(PAST_PAGE);

  const reloadShipments = useCallback(async () => {
    setShipmentsLoading(true);
    setShipmentsError(null);
    try {
      setShipments(await fetchMyShipments());
    } catch {
      setShipmentsError("Failed to load shipments.");
    } finally {
      setShipmentsLoading(false);
    }
  }, []);

  useEffect(() => { void reloadShipments(); }, [reloadShipments]);

  const groups = useMemo(() => {
    const buckets = new Map<GroupKey, MerchantOrder[]>();
    for (const order of readyToShip) {
      const key = groupOf(order, today);
      buckets.set(key, [...(buckets.get(key) ?? []), order]);
    }
    return GROUPS
      .filter((g) => buckets.has(g.key))
      .map((g) => ({ ...g, orders: buckets.get(g.key)!.sort(bySchedule) }));
  }, [readyToShip, today]);

  const active = shipments.filter((sh) => sh.completed_stop_count < sh.stop_count);
  const past = shipments.filter((sh) => sh.completed_stop_count >= sh.stop_count);

  const handleCreate = async () => {
    const ids = [...selection.selectedIds];
    if (ids.length === 0) return;
    setCreating(true);
    setMessage(null);
    try {
      const created = await createMerchantShipment(ids);
      setMessage({
        type: "success",
        text: `Shipment #${created.shipment_id} created with ${ids.length} stop${ids.length === 1 ? "" : "s"}.`,
        shipmentId: created.shipment_id,
      });
      selection.clear();
      await Promise.all([reload(), reloadShipments()]);
    } catch (e: unknown) {
      setMessage({ type: "error", text: getApiErrorMessage(e, "Could not create shipment.") });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={styles.ordersLayout}>
      {/* ── Ready to ship ── */}
      <section className={styles.panel}>
        <div className={s.sectionHead}>
          <div>
            <h2 className={`${styles.panelTitle} ${styles.flush}`}>Ready to ship</h2>
            <p className={s.sectionHint}>
              Paid, confirmed orders not yet on a route. Pick up to {MAX_SHIPMENT_ORDERS} for one run;
              the stop order is computed for you.
            </p>
          </div>
        </div>

        {message?.type === "success" && (
          <div className={`${styles.payoutMessage} ${styles.payoutMessageSuccess} ${s.messageRow}`}>
            <span>{message.text}</span>
            {message.shipmentId != null && (
              <Link className={s.inlineLink} href={`/merchantDashboard/routing/${message.shipmentId}`}>{t.routing.openRouting}</Link>
            )}
          </div>
        )}

        {loading && !loaded && <PageLoader variant="compact" label="Loading orders…" />}
        {error && <p className={`${styles.emptyText} ${styles.errorText}`}>{error}</p>}
        {loaded && readyToShip.length === 0 && (
          <div className={s.emptyBlock}>
            <p className={styles.emptyText}>Nothing waiting to ship.</p>
            <button className={styles.secondaryBtn} onClick={onOpenOrders}>Go to Orders</button>
          </div>
        )}

        {groups.map((group) => (
          <ReadyGroup
            key={group.key}
            label={group.label}
            urgent={group.key === "overdue" || group.key === "today"}
            orders={group.orders}
            selection={selection}
          />
        ))}
      </section>

      {/* Sticky action bar: only while something is selected. */}
      {selection.count > 0 && (
        <div className={s.actionBar} role="region" aria-label="Shipment selection">
          <div className={s.actionBarInfo}>
            <strong>{selection.count} / {MAX_SHIPMENT_ORDERS} selected</strong>
            {message?.type === "error" && <span className={s.actionBarError}>{message.text}</span>}
          </div>
          <div className={s.actionBarButtons}>
            <button className={s.barGhostBtn} disabled={creating} onClick={() => { selection.clear(); setMessage(null); }}>
              Clear
            </button>
            <button className={styles.primaryBtn} disabled={creating} onClick={() => void handleCreate()}>
              {creating ? "Creating shipment…" : "Create shipment"}
            </button>
          </div>
        </div>
      )}

      {/* ── Shipments ── */}
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Active shipments</h2>
        {shipmentsLoading && shipments.length === 0 ? (
          <PageLoader variant="compact" label="Loading shipments…" />
        ) : shipmentsError ? (
          <p className={`${styles.emptyText} ${styles.errorText}`}>{shipmentsError}</p>
        ) : active.length === 0 ? (
          <p className={styles.emptyText}>No shipments on the road.</p>
        ) : (
          <ul className={s.shipmentList}>
            {active.map((sh) => <ShipmentRow key={sh.id} shipment={sh} />)}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Completed shipments</h2>
          <ul className={s.shipmentList}>
            {past.slice(0, pastShown).map((sh) => <ShipmentRow key={sh.id} shipment={sh} />)}
          </ul>
          {past.length > pastShown && (
            <div className={styles.overviewActions}>
              <button className={styles.secondaryBtn} onClick={() => setPastShown((n) => n + PAST_PAGE)}>
                Show more ({past.length - pastShown} left)
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function ReadyGroup({ label, urgent, orders, selection }: {
  label: string;
  urgent: boolean;
  orders: MerchantOrder[];
  selection: ShipmentSelection;
}) {
  const ids = orders.map((o) => o.id);
  const picked = ids.filter((id) => selection.selectedIds.has(id)).length;
  const all = picked === ids.length;
  const some = picked > 0 && !all;

  const boxRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (boxRef.current) boxRef.current.indeterminate = some; }, [some]);

  return (
    <div className={s.group}>
      <label className={s.groupHead}>
        <input
          ref={boxRef}
          type="checkbox"
          checked={all}
          disabled={!all && !some && selection.full}
          onChange={() => selection.setSelected(ids, !all)}
          aria-label={`Select all ${orders.length} orders: ${label}`}
        />
        <span className={`${s.groupLabel} ${urgent ? s.groupLabelUrgent : ""}`}>{label}</span>
        <span className={s.groupCount}>{orders.length}</span>
      </label>

      <ul className={s.readyList}>
        {orders.map((order) => {
          const checked = selection.selectedIds.has(order.id);
          const blocked = !checked && selection.full;
          const itemCount = order.items.length;
          return (
            <li key={order.id}>
              <label className={`${s.readyRow} ${checked ? s.readyRowChecked : ""} ${blocked ? s.readyRowBlocked : ""}`}>
                <input type="checkbox" checked={checked} disabled={blocked} onChange={() => selection.toggle(order.id)} />
                <span className={s.readyId}>#{order.id}</span>
                <span className={s.readyBuyer}>{order.buyer_name ?? "—"}</span>
                <span className={s.readyAddress} title={order.delivery_address ?? undefined}>
                  {order.delivery_address ?? "No address"}
                </span>
                <span className={s.readyWhen}>
                  {order.requested_delivery_date ? formatRequestedDate(order.requested_delivery_date) : "Any day"}
                  {order.delivery_window && ` · ${order.delivery_window}`}
                </span>
                <span className={s.readyItems}>{itemCount} item{itemCount === 1 ? "" : "s"}</span>
                <span className={s.readyTotal}>{formatPeso(order.total_price)}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ShipmentRow({ shipment }: { shipment: MerchantShipmentSummary }) {
  const { t } = useLanguage();
  const { completed_stop_count: done, stop_count: total } = shipment;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <li className={s.shipmentRow}>
      <div className={s.shipmentMain}>
        <strong>Shipment #{shipment.id}</strong>
        <span className={s.shipmentMeta}>{new Date(shipment.created_at).toLocaleString("en-PH")}</span>
      </div>
      <div className={s.shipmentProgress} aria-label={`${done} of ${total} stops completed`}>
        <span className={s.progressTrack}><span className={s.progressFill} style={{ width: `${pct}%` }} /></span>
        <span className={s.shipmentMeta}>{done} / {total} stops</span>
      </div>
      <Link className={styles.secondaryBtn} href={`/merchantDashboard/routing/${shipment.id}`}>{t.routing.routingButton}</Link>
    </li>
  );
}
