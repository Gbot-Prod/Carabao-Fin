"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./page.module.css";
import { fetchCurrentOrders, type CurrentOrderItem } from "@/util/api";

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
            {merchantHref
              ? <Link href={merchantHref}>{order.merchant}</Link>
              : order.merchant}
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

export default function Orders() {
  const [orders, setOrders] = useState<CurrentOrderItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCurrentOrders()
      .then(setOrders)
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Active deliveries</p>
          <h1 className={styles.title}>Current Orders</h1>
        </div>
        <Link href="/history" className={styles.historyLink}>View History</Link>
      </div>

      {loading ? (
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
      )}
    </div>
  );
}
