"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./page.module.css";
import PageLoader from "@/components/PageLoader/PageLoader";
import OrderChat from "@/components/OrderChat/OrderChat";
import {
  confirmOrderReceived,
  createOrderReview,
  fetchOrder,
  isClosed,
  isInTransit,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  updateOrderReview,
  type OrderDetail,
  type OrderStatus,
  type Review,
} from "@/util/api";

// ── Formatting ────────────────────────────────────────────────────────────────

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString("en-PH", {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

// "2026-11-14" parsed as local midnight; new Date("YYYY-MM-DD") would be UTC and can shift a day.
const formatCalendarDate = (value: string) => {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-PH", {
    weekday: "short", year: "numeric", month: "short", day: "numeric",
  });
};

const peso = (value: number) => `₱${value.toLocaleString()}`;

// ── Status progress ───────────────────────────────────────────────────────────

const STEPS = [
  { key: "pending", label: "Placed" },
  { key: "processing", label: "Preparing" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
] as const;

const stepIndex = (status: OrderStatus) => {
  if (status === "out_for_delivery") return 2;
  return STEPS.findIndex((step) => step.key === status);
};

function StatusBadge({ status }: { status: OrderStatus }) {
  const cls =
    status === "cancelled" ? styles.badgeCancelled
    : status === "delivered" ? styles.badgeDelivered
    : isInTransit(status) ? styles.badgeShipped
    : styles.badgePending;
  return <span className={`${styles.badge} ${cls}`}>{ORDER_STATUS_LABELS[status]}</span>;
}

function Progress({ order }: { order: OrderDetail }) {
  if (order.status === "cancelled") {
    return <p className={styles.cancelledNote}>This order was cancelled.</p>;
  }
  const current = stepIndex(order.status);
  const timestamps: Partial<Record<(typeof STEPS)[number]["key"], string | null | undefined>> = {
    pending: order.date_bought,
    shipped: order.shipped_at,
    delivered: order.delivered_at,
  };

  return (
    <ol className={styles.progress}>
      {STEPS.map((step, index) => {
        const state = index < current ? styles.stepDone : index === current ? styles.stepCurrent : "";
        const when = index <= current ? timestamps[step.key] : null;
        return (
          <li key={step.key} className={`${styles.step} ${state}`}>
            <span className={styles.stepDot} aria-hidden />
            <span className={styles.stepLabel}>
              {step.key === "shipped" && order.status === "out_for_delivery" ? "Out for delivery" : step.label}
            </span>
            {when && <span className={styles.stepTime}>{formatDate(when)}</span>}
          </li>
        );
      })}
    </ol>
  );
}

// ── Review ────────────────────────────────────────────────────────────────────

function Stars({ value, onChange }: { value: number; onChange?: (value: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;

  if (!onChange) {
    return (
      <span className={styles.stars} aria-label={`${value} out of 5 stars`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={n <= value ? styles.starOn : styles.starOff} aria-hidden>★</span>
        ))}
      </span>
    );
  }

  return (
    <div className={styles.stars} role="radiogroup" aria-label="Rating" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          className={`${styles.starBtn} ${n <= shown ? styles.starOn : styles.starOff}`}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(n)}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function ReviewSection({
  order,
  onSaved,
}: {
  order: OrderDetail;
  onSaved: (review: Review) => void;
}) {
  const existing = order.review ?? null;
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editable = existing?.editable_until ? new Date(existing.editable_until) > new Date() : false;
  const showForm = (!existing && order.can_review) || editing;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (rating < 1) {
      setError("Pick a star rating first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = { rating, comment: comment.trim() || null };
      const saved = existing
        ? await updateOrderReview(order.order_id, payload)
        : await createOrderReview(order.order_id, payload);
      onSaved(saved);
      setEditing(false);
    } catch {
      setError("Couldn't save your review. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  let body: React.ReactNode;
  if (showForm) {
    body = (
      <form className={styles.reviewForm} onSubmit={(e) => void handleSubmit(e)}>
        <Stars value={rating} onChange={setRating} />
        <textarea
          className={styles.reviewInput}
          aria-label="Your review (optional)"
          placeholder={`How was your order from ${order.merchant}? (optional)`}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={2000}
          rows={3}
        />
        <div className={styles.reviewActions}>
          <button type="submit" className={styles.primaryBtn} disabled={saving}>
            {saving ? "Saving…" : existing ? "Save changes" : "Submit review"}
          </button>
          {editing && (
            <button type="button" className={styles.secondaryBtn} onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </button>
          )}
        </div>
        {order.review_deadline && (
          <p className={styles.muted}>You can edit your review until {formatDate(order.review_deadline)}.</p>
        )}
        {error && <p className={styles.error}>{error}</p>}
      </form>
    );
  } else if (existing) {
    body = (
      <div className={styles.reviewShown}>
        <Stars value={existing.rating} />
        {existing.comment && <p className={styles.reviewComment}>{existing.comment}</p>}
        <p className={styles.muted}>Reviewed {formatDate(existing.created_at)}</p>
        {editable && (
          <button type="button" className={styles.linkBtn} onClick={() => setEditing(true)}>
            Edit review
          </button>
        )}
      </div>
    );
  } else if (order.status === "delivered") {
    body = <p className={styles.muted}>The review window for this order has closed.</p>;
  } else if (order.status === "cancelled") {
    body = <p className={styles.muted}>Cancelled orders can&apos;t be reviewed.</p>;
  } else {
    body = <p className={styles.muted}>You can rate this seller once your order is delivered.</p>;
  }

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>Rate this seller</h2>
      {body}
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OrderDetailPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = Number(params.orderId);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">(
    Number.isInteger(orderId) ? "loading" : "missing",
  );
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isInteger(orderId)) return;
    fetchOrder(orderId)
      .then((data) => { setOrder(data); setState("ready"); })
      .catch(() => setState("missing"));
  }, [orderId]);

  if (state === "loading") return <PageLoader variant="inline" label="Loading order…" />;
  if (state === "missing" || !order) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>Order not found</p>
        <Link href="/orders" className={styles.primaryBtn}>Back to my orders</Link>
      </div>
    );
  }

  const awaitingConfirmation = isInTransit(order.status);
  const subtotal = order.items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const total = order.total_amount ?? subtotal;
  const deliveryFee = Math.max(total - subtotal, 0);
  const schedule = order.requested_delivery_date
    ? [formatCalendarDate(order.requested_delivery_date), order.delivery_window].filter(Boolean).join(", ")
    : order.delivery_window ?? null;

  const handleConfirmReceived = async () => {
    setSubmitting(true);
    setConfirmError(null);
    try {
      await confirmOrderReceived(order.order_id);
      setOrder(await fetchOrder(order.order_id));
      setConfirming(false);
    } catch {
      setConfirmError("Could not confirm this order. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReviewSaved = (review: Review) =>
    setOrder((prev) => (prev ? { ...prev, review, can_review: false } : prev));

  return (
    <div className={styles.container}>
      <Link href="/orders" className={styles.back}>← My orders</Link>

      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Order #{order.order_id}</p>
          <h1 className={styles.title}>
            {order.merchant_id ? <Link href={`/merchant/${order.merchant_id}`}>{order.merchant}</Link> : order.merchant}
          </h1>
          <p className={styles.headerMeta}>Placed {formatDateTime(order.date_bought)}</p>
        </div>
        <StatusBadge status={order.status} />
      </header>

      <section className={styles.card}>
        <Progress order={order} />
        {order.status === "pending" && (
          <p className={styles.muted}>
            We haven&apos;t received payment for this order yet. The seller starts preparing it once you pay;
            unpaid orders are cancelled automatically and the items go back on sale.
          </p>
        )}
        {!isClosed(order.status) && order.status !== "pending" && (
          <div className={styles.actions}>
            <Link href="/track" className={styles.primaryBtn}>Live tracking</Link>
            {awaitingConfirmation && !confirming && (
              <button type="button" className={styles.secondaryBtn} onClick={() => setConfirming(true)}>
                Order received
              </button>
            )}
          </div>
        )}
        {awaitingConfirmation && order.auto_confirm_at && !confirming && (
          <p className={styles.muted}>
            Auto-confirms on {formatDate(order.auto_confirm_at)} if you don&apos;t confirm or contact support.
          </p>
        )}
        {confirming && (
          <div className={styles.confirmRow}>
            <span>Confirm you received this order? This releases payment to the seller.</span>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => void handleConfirmReceived()}
              disabled={submitting}
            >
              {submitting ? "Confirming…" : "Yes, I received it"}
            </button>
            <button type="button" className={styles.secondaryBtn} onClick={() => setConfirming(false)} disabled={submitting}>
              Cancel
            </button>
          </div>
        )}
        {confirmError && <p className={styles.error}>{confirmError}</p>}
      </section>

      <div className={styles.grid}>
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Items</h2>
          <ul className={styles.items}>
            {order.items.map((item, index) => (
              <li key={`${item.id}-${index}`}>
                <span>
                  <span className={styles.itemName}>{item.produce}</span>
                  <span className={styles.itemMeta}>
                    {item.quantity} × {peso(item.price)}{item.unit ? ` / ${item.unit}` : ""}
                  </span>
                </span>
                <span>{peso(item.quantity * item.price)}</span>
              </li>
            ))}
          </ul>
          <dl className={styles.totals}>
            <dt>Subtotal</dt><dd>{peso(subtotal)}</dd>
            <dt>Delivery</dt><dd>{peso(deliveryFee)}</dd>
            <dt className={styles.totalRow}>Total</dt><dd className={styles.totalRow}>{peso(total)}</dd>
            <dt>Payment</dt><dd>{PAYMENT_STATUS_LABELS[order.payment_status]}</dd>
          </dl>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Delivery</h2>
          <dl className={styles.info}>
            <dt>Requested</dt>
            <dd>{schedule ?? <span className={styles.faint}>Not specified</span>}</dd>
            <dt>Address</dt>
            <dd>{order.delivery_address || <span className={styles.faint}>Not specified</span>}</dd>
            <dt>Notes</dt>
            <dd className={styles.notes}>{order.notes || <span className={styles.faint}>None</span>}</dd>
            {order.delivered_at && (
              <>
                <dt>Delivered</dt>
                <dd>
                  {formatDateTime(order.delivered_at)}
                  {order.delivery_confirmed_by === "auto" && <span className={styles.faint}> (auto-confirmed)</span>}
                </dd>
              </>
            )}
          </dl>
        </section>
      </div>

      <ReviewSection key={order.review?.id ?? "new"} order={order} onSaved={handleReviewSaved} />

      {/* Chat with the farm (CH1b) */}
      <OrderChat orderId={order.order_id} />
    </div>
  );
}
