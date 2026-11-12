import { useEffect, useMemo, useState } from "react";
import styles from "../page.module.css";
import s from "./orders.module.css";
import PageLoader from "@/components/PageLoader/PageLoader";
import { ORDER_STATUS_LABELS, updateMerchantOrderStatus, type OrderStatus } from "@/util/api";
import { todayInManila } from "../lib/format";
import type { MerchantOrdersState } from "../hooks/useMerchantOrders";
import OrderCard from "./OrderCard";

// No "pending": unpaid checkouts never reach the merchant.
const ORDER_FILTERS = ["all", "processing", "shipped", "out_for_delivery", "delivered", "cancelled"] as const;
type OrderFilter = typeof ORDER_FILTERS[number];

type Props = {
  ordersState: MerchantOrdersState;
  /** Order to scroll to and highlight once orders are loaded (e.g. from a review). */
  focusOrderId: number | null;
  onFocusDone: () => void;
  onOpenShipments: () => void;
};

export default function OrdersTab({ ordersState, focusOrderId, onFocusDone, onOpenShipments }: Props) {
  const { orders, readyToShip, loaded, loading, error, replaceOrder } = ordersState;
  const today = useMemo(() => todayInManila(), []);

  const [filter, setFilter] = useState<OrderFilter>("all");
  const [updatingOrderId, setUpdatingOrderId] = useState<number | null>(null);

  useEffect(() => {
    if (focusOrderId == null || !loaded) return;
    document.getElementById(`merchant-order-${focusOrderId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = window.setTimeout(onFocusDone, 2500);
    return () => window.clearTimeout(timer);
  }, [focusOrderId, loaded, onFocusDone]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: orders.length };
    for (const o of orders) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [orders]);

  const handleUpdateStatus = async (orderId: number, status: OrderStatus) => {
    setUpdatingOrderId(orderId);
    try {
      replaceOrder(await updateMerchantOrderStatus(orderId, status));
    } catch { /* silently fail */ }
    finally { setUpdatingOrderId(null); }
  };

  // A focused order must be visible whatever filter was last used.
  const activeFilter = focusOrderId != null ? "all" : filter;
  const visibleOrders = orders.filter((o) => activeFilter === "all" || o.status === activeFilter);

  return (
    <div className={styles.ordersLayout}>
      <div className={styles.ordersHeader}>
        <h2 className={`${styles.sectionTitle} ${styles.flush}`}>Customer Orders</h2>
        <div className={styles.orderFilterRow}>
          {ORDER_FILTERS.map((f) => (
            <button
              key={f}
              className={`${styles.filterChip} ${activeFilter === f ? styles.filterChipActive : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : ORDER_STATUS_LABELS[f]}
              {loaded && <span className={s.chipCount}>{counts[f] ?? 0}</span>}
            </button>
          ))}
        </div>
      </div>

      {readyToShip.length > 0 && (
        <div className={s.readyBanner}>
          <span>
            <strong>{readyToShip.length}</strong> confirmed order{readyToShip.length === 1 ? " is" : "s are"} ready to ship.
          </span>
          <button className={styles.primaryBtn} onClick={onOpenShipments}>Plan a shipment →</button>
        </div>
      )}

      {loading && !loaded && <PageLoader variant="compact" label="Loading orders…" />}
      {!loading && error && <p className={`${styles.emptyText} ${styles.errorText}`}>{error}</p>}
      {loaded && orders.length === 0 && <p className={styles.emptyText}>No orders yet.</p>}
      {loaded && orders.length > 0 && visibleOrders.length === 0 && (
        <p className={styles.emptyText}>No {activeFilter} orders.</p>
      )}

      <div className={s.orderList}>
        {visibleOrders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            today={today}
            focused={focusOrderId === order.id}
            updating={updatingOrderId === order.id}
            onUpdateStatus={(status) => void handleUpdateStatus(order.id, status)}
          />
        ))}
      </div>
    </div>
  );
}
