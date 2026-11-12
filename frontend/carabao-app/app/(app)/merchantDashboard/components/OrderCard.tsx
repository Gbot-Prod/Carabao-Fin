import { useState } from "react";
import styles from "../page.module.css";
import s from "./orders.module.css";
import OrderChat from "@/components/OrderChat/OrderChat";
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  isClosed,
  isInTransit,
  type MerchantOrder,
  type OrderStatus,
} from "@/util/api";
import { addDays, formatDate, formatPeso, formatRequestedDate } from "../lib/format";

type DeliveryUrgency = "overdue" | "today" | "tomorrow";

// Only orders not yet shipped still need scheduling, so only they get flagged.
const deliveryUrgency = (order: MerchantOrder, today: string): DeliveryUrgency | null => {
  const requested = order.requested_delivery_date;
  if (!requested || order.status !== "processing") return null;
  if (requested < today) return "overdue";
  if (requested === today) return "today";
  if (requested === addDays(today, 1)) return "tomorrow";
  return null;
};

const URGENCY_LABEL: Record<DeliveryUrgency, string> = {
  overdue: "Past requested date",
  today: "Deliver today",
  tomorrow: "Deliver tomorrow",
};

type Props = {
  order: MerchantOrder;
  today: string;
  focused: boolean;
  updating: boolean;
  onUpdateStatus: (status: OrderStatus) => void;
};

/** Collapsed to one summary line; click to see contact, address, note and items. */
export default function OrderCard({ order, today, focused, updating, onUpdateStatus }: Props) {
  const [expanded, setExpanded] = useState(false);
  // An order jumped to from a review opens itself.
  const open = expanded || focused;

  const urgency = deliveryUrgency(order, today);
  const itemCount = order.items.length;
  const isOpenOrder = !isClosed(order.status);
  const detailsId = `merchant-order-details-${order.id}`;

  return (
    <div id={`merchant-order-${order.id}`} className={`${styles.orderCard} ${s.orderCard} ${focused ? styles.orderCardFocused : ""}`}>
      <div className={s.orderSummary}>
        <button
          type="button"
          className={s.orderToggle}
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setExpanded(!open)}
        >
          <span className={`${s.chevron} ${open ? s.chevronOpen : ""}`} aria-hidden="true">›</span>
          <span className={styles.orderIdLabel}>#{order.id}</span>
          <span className={`${styles.orderStatusBadge} ${styles[`orderStatus_${order.status}`]}`}>{ORDER_STATUS_LABELS[order.status]}</span>
          {/* Merchants only see paid orders, so only call out anything else (refunds). */}
          {order.payment_status !== "paid" && (
            <span className={`${styles.txBadge} ${styles[`txBadge_${order.payment_status}`]}`}>
              {PAYMENT_STATUS_LABELS[order.payment_status]}
            </span>
          )}
          {urgency && (
            <span className={`${styles.urgencyBadge} ${styles[`urgency_${urgency}`]}`}>{URGENCY_LABEL[urgency]}</span>
          )}
          <span className={s.summaryText}>
            {order.buyer_name ?? "—"}
            {" · "}
            {order.requested_delivery_date ? formatRequestedDate(order.requested_delivery_date) : "Any day"}
            {" · "}
            {itemCount} item{itemCount === 1 ? "" : "s"}
          </span>
          {order.notes && <span className={s.noteFlag} title="Buyer left a note">Note</span>}
          <strong className={`${styles.orderTotal} ${s.summaryTotal}`}>{formatPeso(order.total_price)}</strong>
        </button>

        {isOpenOrder && (
          <div className={s.summaryActions}>
            <button className={styles.orderCancelBtn} disabled={updating} onClick={() => onUpdateStatus("cancelled")}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {open && (
        <div id={detailsId} className={s.orderDetails}>
          {/* Chat with the buyer (CH1b); mounted only while expanded. */}
          <OrderChat orderId={order.id} />
          <div className={styles.orderBuyer}>
            <span className={styles.orderBuyerLabel}>Buyer</span>
            <span className={styles.orderBuyerName}>{order.buyer_name ?? "—"}</span>
            {order.buyer_email && <span className={styles.orderBuyerContact}>{order.buyer_email}</span>}
            {order.buyer_phone && <span className={styles.orderBuyerContact}>{order.buyer_phone}</span>}
          </div>

          {order.delivery_address && (
            <div className={styles.orderAddress}>
              <span className={styles.orderBuyerLabel}>Deliver to</span>
              <span>{order.delivery_address}</span>
            </div>
          )}

          <div className={styles.orderAddress}>
            <span className={styles.orderBuyerLabel}>Requested</span>
            {order.requested_delivery_date || order.delivery_window ? (
              <span className={styles.orderSchedule}>
                {order.requested_delivery_date ? formatRequestedDate(order.requested_delivery_date) : "Any day"}
                {order.delivery_window && ` · ${order.delivery_window}`}
              </span>
            ) : (
              <span>No date requested</span>
            )}
          </div>

          <div className={styles.orderAddress}>
            <span className={styles.orderBuyerLabel}>Ordered</span>
            <span>{formatDate(order.ordered_at)}</span>
          </div>

          {order.notes && (
            <div className={styles.orderNotes}>
              <span className={styles.orderBuyerLabel}>Buyer note</span>
              <p className={styles.orderNotesText}>{order.notes}</p>
            </div>
          )}

          <div className={styles.orderItems}>
            {order.items.map((item, i) => (
              <div key={i} className={styles.orderItem}>
                <span className={styles.orderItemName}>{item.produce ?? "Item"}</span>
                <span className={styles.orderItemQty}>×{item.quantity}</span>
                <span className={styles.orderItemPrice}>{item.price != null ? `₱${item.price}/${item.unit ?? "unit"}` : ""}</span>
              </div>
            ))}
          </div>

          {isInTransit(order.status) && (
            <span className={styles.orderAwaiting}>
              Awaiting buyer confirmation
              {order.auto_confirm_at && ` · auto-confirms ${formatDate(order.auto_confirm_at)}`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
