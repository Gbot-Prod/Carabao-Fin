"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./page.module.css";
import PageLoader from "@/components/PageLoader/PageLoader";
import {
  fetchCurrentOrders,
  fetchOrderHistory,
  deleteOrderFromHistory,
  confirmOrderReceived,
  type CurrentOrderItem,
  type OrderHistoryItem,
} from "@/util/api";

// ── Current orders ────────────────────────────────────────────────────────────

function StatusBadge({ shipped, status }: { shipped: boolean; status: string }) {
  const normalized = status.toLowerCase();
  let cls = styles.badgePending;
  if (shipped || normalized === "shipped" || normalized === "delivered") cls = styles.badgeShipped;
  else if (normalized === "cancelled") cls = styles.badgeCancelled;

  const label = normalized === "delivered"
    ? "Delivered"
    : shipped ? "Shipped" : status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={`${styles.badge} ${cls}`}>{label}</span>;
}

const formatShortDate = (value: string) =>
  new Date(value).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });

function OrderCard({
  order,
  onConfirmed,
}: {
  order: CurrentOrderItem;
  onConfirmed: (updated: CurrentOrderItem) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const awaitingConfirmation = ["shipped", "out_for_delivery"].includes(order.status.toLowerCase());

  const handleConfirmReceived = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const updated = await confirmOrderReceived(order.order_id);
      onConfirmed({ ...order, ...updated, id: order.id });
      setConfirming(false);
    } catch {
      setError("Could not confirm this order. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const merchantHref = order.merchant_id ? `/merchant/${order.merchant_id}` : null;
  const dateBought = new Date(order.date_bought).toLocaleDateString("en-PH", {
    year: "numeric", month: "short", day: "numeric",
  });
  const eta = order.time_of_arrival
    ? new Date(order.time_of_arrival).toLocaleDateString("en-PH", {
        year: "numeric", month: "short", day: "numeric",
      })
    : null;

  const itemSummary = order.items.length > 0
    ? order.items.map((item) => `${item.produce}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`).join(', ')
    : null;

  return (
    <li className={styles.card}>
      <div className={styles.cardTop}>
        <div>
          <h3 className={styles.merchant}>
            {merchantHref ? <Link href={merchantHref}>{order.merchant}</Link> : order.merchant}
          </h3>
          {itemSummary && <p className={styles.itemSummary}>{itemSummary}</p>}
        </div>
        <StatusBadge shipped={order.shipped} status={order.status} />
      </div>

      <div className={styles.cardMeta}>
        <span>Ordered {dateBought}</span>
        {eta && <><span className={styles.dot}>•</span><span>ETA {eta}</span></>}
        <span className={styles.dot}>•</span>
        <span>₱{order.delivery_fee.toLocaleString()} delivery</span>
      </div>

      <div className={styles.cardActions}>
        <Link href="/track" className={styles.trackBtn}>Live Tracking</Link>
        {awaitingConfirmation && !confirming && (
          <button type="button" className={styles.receivedBtn} onClick={() => setConfirming(true)}>
            Order Received
          </button>
        )}
      </div>

      {awaitingConfirmation && order.auto_confirm_at && !confirming && (
        <p className={styles.autoConfirmNote}>
          Auto-confirms on {formatShortDate(order.auto_confirm_at)} if you don&apos;t confirm or contact support.
        </p>
      )}

      {confirming && (
        <div className={styles.confirmRow}>
          <span>Confirm you received this order? This releases payment to the seller.</span>
          <button
            type="button"
            className={styles.confirmReceivedYes}
            onClick={() => void handleConfirmReceived()}
            disabled={submitting}
          >
            {submitting ? "Confirming…" : "Yes, I received it"}
          </button>
          <button
            type="button"
            className={styles.confirmNo}
            onClick={() => setConfirming(false)}
            disabled={submitting}
          >
            Cancel
          </button>
        </div>
      )}
      {error && <p className={styles.confirmError}>{error}</p>}
    </li>
  );
}

// ── Past orders ───────────────────────────────────────────────────────────────

function PastOrderCard({
  order,
  onDelete,
}: {
  order: OrderHistoryItem;
  onDelete: (id: number) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const merchantHref = order.merchant_id ? `/merchant/${order.merchant_id}` : null;

  const handleConfirm = async () => {
    setDeleting(true);
    try {
      await deleteOrderFromHistory(order.order_id);
      onDelete(order.id);
    } catch {
      setDeleting(false);
      setConfirming(false);
    }
  };

  const orderDate = new Date(order.order_date).toLocaleDateString("en-PH", {
    year: "numeric", month: "short", day: "numeric",
  });

  return (
    <li className={styles.card}>
      <div className={styles.cardTop}>
        <div>
          <p className={styles.orderId}>Order #{order.order_id}</p>
          <h3 className={styles.merchant}>
            {merchantHref ? <Link href={merchantHref}>{order.merchant}</Link> : order.merchant}
          </h3>
        </div>
        <div className={styles.pastCardRight}>
          <span className={`${styles.badge} ${styles.badgeShipped}`}>{order.status}</span>
          {!confirming && (
            <button type="button" className={styles.deleteBtn} onClick={() => setConfirming(true)}>
              Remove
            </button>
          )}
        </div>
      </div>

      <div className={styles.cardMeta}>
        <span>{orderDate}</span>
        <span className={styles.dot}>•</span>
        <span>₱{order.total_amount.toLocaleString()}</span>
      </div>

      {confirming && (
        <div className={styles.confirmRow}>
          <span>Remove this order from history?</span>
          <button
            type="button"
            className={styles.confirmYes}
            onClick={() => void handleConfirm()}
            disabled={deleting}
          >
            {deleting ? "Removing…" : "Yes, remove"}
          </button>
          <button
            type="button"
            className={styles.confirmNo}
            onClick={() => setConfirming(false)}
            disabled={deleting}
          >
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = "current" | "history";

export default function Orders() {
  const [tab, setTab] = useState<Tab>("current");
  const [orders, setOrders] = useState<CurrentOrderItem[]>([]);
  const [pastOrders, setPastOrders] = useState<OrderHistoryItem[]>([]);
  const [loadingCurrent, setLoadingCurrent] = useState(true);
  const [historyFetched, setHistoryFetched] = useState(false);
  const loadingHistory = tab === "history" && !historyFetched;

  useEffect(() => {
    fetchCurrentOrders()
      .then(setOrders)
      .catch(() => setOrders([]))
      .finally(() => setLoadingCurrent(false));
  }, []);

  useEffect(() => {
    if (tab === "history" && !historyFetched) {
      fetchOrderHistory()
        .then(setPastOrders)
        .catch(() => setPastOrders([]))
        .finally(() => { setHistoryFetched(true); });
    }
  }, [tab, historyFetched]);

  const handleConfirmed = (updated: CurrentOrderItem) => {
    setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
  };

  const handleDelete = (id: number) => {
    setPastOrders((prev) => prev.filter((o) => o.id !== id));
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>My Orders</p>
          <h1 className={styles.title}>{tab === "current" ? "Current Orders" : "Order History"}</h1>
        </div>
        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${tab === "current" ? styles.tabActive : ""}`}
            onClick={() => setTab("current")}
          >
            Current
          </button>
          <button
            type="button"
            className={`${styles.tab} ${tab === "history" ? styles.tabActive : ""}`}
            onClick={() => setTab("history")}
          >
            History
          </button>
        </div>
      </div>

      {tab === "current" && (
        loadingCurrent ? (
          <PageLoader variant="inline" label="Loading your orders…" />
        ) : orders.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No active orders</p>
            <p className={styles.emptyText}>Once you place an order it will appear here.</p>
            <Link href="/order" className={styles.browseLink}>Browse Shops</Link>
          </div>
        ) : (
          <ul className={styles.list}>
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} onConfirmed={handleConfirmed} />
            ))}
          </ul>
        )
      )}

      {tab === "history" && (
        loadingHistory ? (
          <PageLoader variant="inline" label="Loading order history…" />
        ) : pastOrders.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No past orders</p>
            <p className={styles.emptyText}>Completed orders will show up here.</p>
          </div>
        ) : (
          <ul className={styles.list}>
            {pastOrders.map((order) => (
              <PastOrderCard key={order.id} order={order} onDelete={handleDelete} />
            ))}
          </ul>
        )
      )}
    </div>
  );
}
