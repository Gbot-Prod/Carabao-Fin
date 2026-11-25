"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent, type ReactNode } from "react";
import styles from "./page.module.css";
import getApiErrorMessage from "@/util/errorHelper";
import SkeletonList, { LoadError } from "@/components/Skeleton/Skeleton";
import Pagination from "@/components/Pagination/Pagination";
import {
  HISTORY_FILTERS,
  HISTORY_PAGE_SIZE,
  HISTORY_SEARCH_MAX,
  pageAfterRemoval,
  tabFromParam,
  type HistoryFilter,
} from "@/lib/order-history";
import {
  cancelMyOrder,
  cancelPaymentCheckout,
  confirmOrderReceived,
  createPaymentCheckout,
  deleteOrderFromHistory,
  fetchOrderHistoryPage,
  isClosed,
  isInTransit,
  reorderOrder,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  type OrderHistoryItem,
  type ReorderResult,
} from "@/util/api";

// How many lines a card shows before "+N more".
const LINES_SHOWN = 3;

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });

const peso = (value: number) => `₱${value.toLocaleString()}`;

const getInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");

// ── Card parts ───────────────────────────────────────────────────────────────

function ShopMark({ name, logoUrl }: { name: string; logoUrl?: string | null }) {
  return (
    <span className={styles.shopMark} aria-hidden>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" loading="lazy" />
      ) : (
        <span>{getInitials(name) || "?"}</span>
      )}
    </span>
  );
}

/** The short line beside the status, like "Delivered on Nov 20, 2026". */
function statusHint(order: OrderHistoryItem): string | null {
  switch (order.status) {
    case "processing":
      return "The farm is preparing your order";
    case "shipped":
    case "out_for_delivery":
      return order.time_of_arrival ? `Arrives by ${formatDate(order.time_of_arrival)}` : "Your order is on the way";
    case "delivered":
      return order.delivered_at ? `Delivered on ${formatDate(order.delivered_at)}` : "Your order was delivered";
    default:
      return null;
  }
}

function statusTone(order: OrderHistoryItem) {
  if (order.status === "cancelled" || order.status === "payment_mismatch") return styles.toneDanger;
  if (order.status === "delivered") return styles.toneDone;
  if (order.status === "pending") return styles.toneWarn;
  return styles.toneActive;
}

function OrderLines({ order }: { order: OrderHistoryItem }) {
  const shown = order.items.slice(0, LINES_SHOWN);
  const more = order.items.length - shown.length;
  return (
    <Link href={`/orders/${order.order_id}`} className={styles.lines}>
      {shown.map((item, index) => (
        <div key={`${item.id}-${index}`} className={styles.line}>
          {item.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.image} alt="" className={styles.lineImg} loading="lazy" />
          ) : (
            <span className={`${styles.lineImg} ${styles.lineImgEmpty}`} aria-hidden>🌱</span>
          )}
          <div className={styles.lineText}>
            <p className={styles.lineName}>{item.produce}</p>
            <p className={styles.lineQty}>
              ×{item.quantity}{item.unit ? ` ${item.unit}` : ""}
            </p>
          </div>
          <p className={styles.linePrice}>{peso(item.price * item.quantity)}</p>
        </div>
      ))}
      {more > 0 && <p className={styles.moreLines}>+{more} more item{more === 1 ? "" : "s"}</p>}
      {order.items.length === 0 && <p className={styles.moreLines}>Order #{order.order_id}</p>}
    </Link>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

type Confirm = "received" | "cancel" | "remove" | null;

function OrderCard({
  order,
  onChanged,
  onRemoved,
}: {
  order: OrderHistoryItem;
  onChanged: () => void;
  onRemoved: () => void;
}) {
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reorder, setReorder] = useState<ReorderResult | null>(null);

  const merchantHref = order.merchant_id ? `/farms/${order.merchant_id}` : null;
  const detailHref = `/orders/${order.order_id}`;
  const chatHref = `/chats?order=${order.order_id}`;
  const hint = statusHint(order);
  const toPay = order.status === "pending";
  const toShip = order.status === "processing";
  const toReceive = isInTransit(order.status);
  const completed = order.status === "delivered";
  const closed = isClosed(order.status);

  // Runs one action; shows the API's message when it fails.
  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(getApiErrorMessage(err) ?? fallback);
    } finally {
      setBusy(false);
    }
  };

  // Reopens (or recreates) the PayMongo checkout. If an earlier session was
  // already paid, the backend settles it and refuses, so reload to show it.
  const payNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const checkout = await createPaymentCheckout(order.order_id);
      window.location.href = checkout.checkout_url;
    } catch {
      setError("This order could not be paid now. It may already be paid or have expired. Refreshing…");
      setBusy(false);
      setTimeout(onChanged, 2000);
    }
  };

  const confirmAction = () => {
    if (confirm === "received") {
      return run(async () => {
        await confirmOrderReceived(order.order_id);
        setConfirm(null);
        onChanged();
      }, "Could not confirm this order. Please try again.");
    }
    if (confirm === "cancel") {
      return run(async () => {
        // An unpaid order releases its checkout; a paid one goes to the refund queue.
        if (toPay) await cancelPaymentCheckout(order.order_id);
        else await cancelMyOrder(order.order_id);
        setConfirm(null);
        onChanged();
      }, "Could not cancel this order. Please try again.");
    }
    return run(async () => {
      await deleteOrderFromHistory(order.order_id);
      onRemoved();
    }, "Could not remove this order. Try again.");
  };

  const buyAgain = () =>
    run(async () => {
      setReorder(await reorderOrder(order.order_id));
    }, "Couldn't add these items right now. Please try again.");

  const confirmText = {
    received: ["Confirm you received this order? This releases payment to the farm.", "Yes, I received it"],
    cancel: [
      toPay ? "Cancel this order? Its items go back on sale." : "Cancel this order? Your payment will be refunded.",
      "Yes, cancel order",
    ],
    remove: ["Remove this order from your list?", "Yes, remove"],
  } as const;

  // The note on the left of the footer.
  let note: ReactNode = null;
  if (toReceive && order.auto_confirm_at) {
    note = <>Auto-confirms on {formatDate(order.auto_confirm_at)}</>;
  } else if (completed && order.can_review && order.review_deadline) {
    note = <>Rate this order by <u>{formatDate(order.review_deadline)}</u></>;
  } else if (completed && order.reviewed) {
    note = <>You rated this order</>;
  } else if (closed && !completed) {
    note = <>{PAYMENT_STATUS_LABELS[order.payment_status]}</>;
  } else if (toPay) {
    note = <>Placed {formatDate(order.order_date)}</>;
  }

  return (
    <li className={styles.card}>
      <div className={styles.cardHead}>
        <div className={styles.shop}>
          <ShopMark name={order.merchant} logoUrl={order.merchant_logo_url} />
          <span className={styles.shopName}>{order.merchant}</span>
          <Link href={chatHref} className={styles.chatBtn}>Chat</Link>
          {merchantHref && <Link href={merchantHref} className={styles.shopBtn}>View Farm</Link>}
        </div>
        <div className={styles.status}>
          {hint && <span className={styles.statusHint}>{hint}</span>}
          <span className={`${styles.statusLabel} ${statusTone(order)}`}>
            {ORDER_STATUS_LABELS[order.status]}
          </span>
        </div>
      </div>

      <OrderLines order={order} />

      <div className={styles.cardFoot}>
        <p className={styles.total}>
          Order Total: <strong>{peso(order.total_amount)}</strong>
        </p>
        <div className={styles.footRow}>
          <div className={styles.note}>
            {note}
            {closed && confirm === null && (
              <button type="button" className={styles.removeBtn} onClick={() => setConfirm("remove")}>
                Remove
              </button>
            )}
          </div>

          {confirm === null && (
            <div className={styles.actions}>
              {toPay && (
                <>
                  <button type="button" className={styles.primary} onClick={() => void payNow()} disabled={busy}>
                    {busy ? "Opening payment…" : "Pay Now"}
                  </button>
                  <button type="button" className={styles.secondary} onClick={() => setConfirm("cancel")}>
                    Cancel Order
                  </button>
                  <Link href={detailHref} className={styles.secondary}>View Order</Link>
                </>
              )}
              {toShip && (
                <>
                  <Link href={chatHref} className={styles.primary}>Contact Farm</Link>
                  <button type="button" className={styles.secondary} onClick={() => setConfirm("cancel")}>
                    Cancel Order
                  </button>
                  <Link href={detailHref} className={styles.secondary}>View Order</Link>
                </>
              )}
              {toReceive && (
                <>
                  <button type="button" className={styles.primary} onClick={() => setConfirm("received")}>
                    Order Received
                  </button>
                  <Link href="/track" className={styles.secondary}>Live Tracking</Link>
                  <Link href={chatHref} className={styles.secondary}>Contact Farm</Link>
                </>
              )}
              {completed && (
                <>
                  <Link
                    href={`${detailHref}#review`}
                    className={order.can_review ? styles.primary : styles.secondary}
                  >
                    {order.reviewed ? "View Rating" : order.can_review ? "Rate" : "View Order"}
                  </Link>
                  <Link href={chatHref} className={styles.secondary}>Contact Farm</Link>
                  <button type="button" className={styles.secondary} onClick={() => void buyAgain()} disabled={busy}>
                    {busy ? "Adding…" : "Buy Again"}
                  </button>
                </>
              )}
              {closed && !completed && (
                <>
                  <button type="button" className={styles.primary} onClick={() => void buyAgain()} disabled={busy}>
                    {busy ? "Adding…" : "Buy Again"}
                  </button>
                  <Link href={detailHref} className={styles.secondary}>View Order</Link>
                </>
              )}
            </div>
          )}
        </div>

        {confirm !== null && (
          <div className={styles.confirmRow}>
            <span>{confirmText[confirm][0]}</span>
            <div className={styles.actions}>
              <button
                type="button"
                className={confirm === "received" ? styles.primary : styles.danger}
                onClick={() => void confirmAction()}
                disabled={busy}
              >
                {busy ? "Please wait…" : confirmText[confirm][1]}
              </button>
              <button type="button" className={styles.secondary} onClick={() => setConfirm(null)} disabled={busy}>
                Back
              </button>
            </div>
          </div>
        )}

        {error && <p className={styles.error} role="alert">{error}</p>}

        {reorder && (
          <div className={styles.reorderResult} role="status">
            <p>
              {reorder.added.length > 0
                ? `Added ${reorder.added.length} item${reorder.added.length === 1 ? "" : "s"} to your cart.`
                : "None of these items can be ordered right now."}{" "}
              {reorder.added.length > 0 && <Link href="/cart">Go to cart</Link>}
            </p>
            {reorder.added.some((a) => a.reduced_from) && (
              <ul>
                {reorder.added.filter((a) => a.reduced_from).map((a) => (
                  <li key={a.produce_id}>{a.name}: only {a.quantity} left (you had {a.reduced_from})</li>
                ))}
              </ul>
            )}
            {reorder.unavailable.length > 0 && (
              <>
                <p>Not added:</p>
                <ul>
                  {reorder.unavailable.map((u, i) => <li key={`${u.name}-${i}`}>{u.name}: {u.reason}</li>)}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

const EMPTY_TEXT: Record<HistoryFilter | "", string> = {
  "": "Once you place an order it will appear here.",
  to_pay: "No orders are waiting for payment.",
  to_ship: "No orders are waiting for the farm to ship.",
  to_receive: "No orders are on the way.",
  delivered: "Delivered orders will show up here.",
  cancelled: "No cancelled orders.",
};

function OrdersList() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = tabFromParam(params.get("tab"));

  const [orders, setOrders] = useState<OrderHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The request the list on screen came from; any other key is still loading.
  const requestKey = `${tab}|${page}|${query}|${attempt}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let live = true;
    fetchOrderHistoryPage({ page, status: tab, q: query })
      .then((result) => {
        if (!live) return;
        setOrders(result.items);
        setTotal(result.total);
        setError(false);
      })
      .catch(() => live && setError(true))
      .finally(() => live && setLoadedKey(requestKey));
    return () => { live = false; };
  }, [tab, page, query, requestKey]);

  const reload = () => setAttempt((n) => n + 1);

  const changeTab = (value: HistoryFilter | "") => {
    setPage(1);
    router.replace(value ? `${pathname}?tab=${value}` : pathname, { scroll: false });
  };

  const submitSearch = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setQuery(search.trim());
    setPage(1);
  };

  const clearSearch = () => {
    setSearch("");
    setQuery("");
    setPage(1);
  };

  const handleRemoved = () => {
    // Refetch so the page fills up again from the next one.
    setPage(pageAfterRemoval(page, total));
    reload();
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Your purchases</p>
        <h1 className={styles.title}>My Orders</h1>
        <p className={styles.description}>Pay, track, receive and rate your orders from farms.</p>
      </div>

      <div className={styles.controls}>
        <nav className={styles.tabs} aria-label="Order status">
          {HISTORY_FILTERS.map((f) => (
            <button
              key={f.value || "all"}
              type="button"
              className={`${styles.tab} ${tab === f.value ? styles.tabActive : ""}`}
              aria-current={tab === f.value ? "page" : undefined}
              onClick={() => changeTab(f.value)}
            >
              {f.label}
            </button>
          ))}
        </nav>

        <form className={styles.search} onSubmit={submitSearch} role="search">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden className={styles.searchIcon}>
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={search}
            maxLength={HISTORY_SEARCH_MAX}
            placeholder="Search by farm name, order number or product"
            aria-label="Search orders"
            onChange={(e) => setSearch(e.target.value)}
          />
          {query && (
            <button type="button" className={styles.searchClear} onClick={clearSearch}>Clear</button>
          )}
        </form>
      </div>

      <div className={styles.scroll}>
      {loading ? (
        <SkeletonList label="Loading your orders…" rows={3} />
      ) : error ? (
        <LoadError message="We couldn't load your orders. Check your connection and try again." onRetry={reload} />
      ) : orders.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{query ? "No matching orders" : "No orders yet"}</p>
          <p className={styles.emptyText}>
            {query ? "Try another farm name, order number or product." : EMPTY_TEXT[tab]}
          </p>
          {!query && tab === "" && <Link href="/order" className={styles.primary}>Browse Shops</Link>}
        </div>
      ) : (
        <>
          <ul className={styles.list}>
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} onChanged={reload} onRemoved={handleRemoved} />
            ))}
          </ul>
          {total > HISTORY_PAGE_SIZE && (
            <Pagination
              page={page}
              pageSize={HISTORY_PAGE_SIZE}
              total={total}
              disabled={loading}
              onPageChange={setPage}
            />
          )}
        </>
      )}
      </div>
    </div>
  );
}

export default function Orders() {
  return (
    <Suspense fallback={<SkeletonList label="Loading your orders…" rows={3} />}>
      <OrdersList />
    </Suspense>
  );
}
