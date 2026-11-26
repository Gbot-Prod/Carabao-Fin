import { useState } from "react";
import styles from "../page.module.css";
import s from "./orders.module.css";
import OrderChat from "@/components/OrderChat/OrderChat";
import CancelOrderForm from "./CancelOrderForm";
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  isClosed,
  isInTransit,
  type MerchantCancelReason,
  type MerchantOrder,
} from "@/util/api";
import { formatDate, formatPeso } from "../lib/format";

const USE_MERCHANT_APP = "Use the merchant app: this needs a photo at the address.";

type Props = {
  order: MerchantOrder;
  focused: boolean;
  /** Cancels with the farm's reason; rejects with the API error. */
  onCancel: (reason: MerchantCancelReason, note: string) => Promise<void>;
};

/** Collapsed to one summary line; click to see contact, address, note and items. */
export default function OrderCard({ order, focused, onCancel }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // An order jumped to from a review opens itself.
  const open = expanded || focused;

  const itemCount = order.items.length;
  const isOpenOrder = !isClosed(order.status);
  const photoOnlyCancel = order.status === "out_for_delivery";
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
          <span className={s.summaryText}>
            {order.buyer_name ?? "—"}
            {" · "}
            {formatDate(order.ordered_at)}
            {" · "}
            {itemCount} item{itemCount === 1 ? "" : "s"}
          </span>
          {order.notes && <span className={s.noteFlag} title="Buyer left a note">Note</span>}
          <strong className={`${styles.orderTotal} ${s.summaryTotal}`}>{formatPeso(order.total_price)}</strong>
        </button>

        {isOpenOrder && !cancelling && (
          <div className={s.summaryActions}>
            {/* ORDER_PROOF_PHOTOS_PLAN.md: out for delivery, a cancel needs a photo at the
                address, which only the merchant app takes. */}
            <button
              className={styles.orderCancelBtn}
              disabled={photoOnlyCancel}
              title={photoOnlyCancel ? USE_MERCHANT_APP : undefined}
              onClick={() => setCancelling(true)}
            >
              Cancel
            </button>
            {photoOnlyCancel && <span className={s.sectionHint}>{USE_MERCHANT_APP}</span>}
          </div>
        )}
      </div>

      {isOpenOrder && cancelling && !photoOnlyCancel && (
        <CancelOrderForm
          orderId={order.id}
          onSubmit={async (reason, note) => {
            await onCancel(reason, note);
            setCancelling(false);
          }}
          onClose={() => setCancelling(false)}
        />
      )}

      {order.status === "cancelled" && order.cancel_reason && (
        <p className={s.cancelledReason}>
          <span className={styles.orderBuyerLabel}>Cancel reason</span> {order.cancel_reason}
        </p>
      )}

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
