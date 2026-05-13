"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./page.module.css";
import {
  fetchCurrentOrders,
  fetchOrderHistory,
  deleteOrderFromHistory,
  type CurrentOrderItem,
  type OrderHistoryItem,
} from "@/util/api";

// ── Current orders ────────────────────────────────────────────────────────────

function StatusBadge({ shipped, status }: { shipped: boolean; status: string }) {
  const normalized = status.toLowerCase();
  let cls = styles.badgePending;
  if (shipped || normalized === "shipped" || normalized === "delivered") cls = styles.badgeShipped;
  else if (normalized === "cancelled") cls = styles.badgeCancelled;

  const label = shipped ? "Shipped" : status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={`${styles.badge} ${cls}`}>{label}</span>;
}

function OrderCard({ order }: { order: CurrentOrderItem }) {
  const merchantHref = order.merchant_id ? `/merchant/${order.merchant_id}` : null;
  const dateBought = new Date(order.date_bought).toLocaleDateString("en-PH", {
    year: "numeric", month: "short", day: "numeric",
  });
  const eta = order.time_of_arrival
    ? new Date(order.time_of_arrival).toLocaleDateString("en-PH", {
        year: "numeric", month: "short", day: "numeric",
      })
    : null;

  return (
    <li className={styles.card}>
      <div className={styles.cardTop}>
        <div>
          <p className={styles.orderId}>Order #{order.order_id}</p>
          <h3 className={styles.merchant}>
            {merchantHref ? <Link href={merchantHref}>{order.merchant}</Link> : order.merchant}
          </h3>
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
      </div>
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
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyFetched, setHistoryFetched] = useState(false);

  useEffect(() => {
    fetchCurrentOrders()
      .then(setOrders)
      .catch(() => setOrders([]))
      .finally(() => setLoadingCurrent(false));
  }, []);

  useEffect(() => {
    if (tab === "history" && !historyFetched) {
      setLoadingHistory(true);
      fetchOrderHistory()
        .then(setPastOrders)
        .catch(() => setPastOrders([]))
        .finally(() => { setLoadingHistory(false); setHistoryFetched(true); });
    }
  }, [tab, historyFetched]);

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
          <div className={styles.empty}>Loading your orders…</div>
        ) : orders.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No active orders</p>
            <p className={styles.emptyText}>Once you place an order it will appear here.</p>
            <Link href="/order" className={styles.browseLink}>Browse Shops</Link>
          </div>
        ) : (
          <ul className={styles.list}>
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </ul>
        )
      )}

      {tab === "history" && (
        loadingHistory ? (
          <div className={styles.empty}>Loading history…</div>
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
