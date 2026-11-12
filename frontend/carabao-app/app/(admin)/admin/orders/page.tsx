"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ADMIN_PAGE_SIZE,
  fetchAdminMerchants,
  fetchAdminOrder,
  fetchAdminOrders,
  type AdminOrderDetail,
  type AdminOrderFilters,
  type AdminOrderStatus,
  type AdminOrderSummary,
  type AdminPaymentStatus,
  type Merchant,
} from "@/util/api/admin";
import Pagination from "../../Pagination";
import styles from "./page.module.css";
import PageLoader from "@/components/PageLoader/PageLoader";

const ORDER_STATUSES: AdminOrderStatus[] = ["pending", "processing", "shipped", "out_for_delivery", "delivered", "cancelled"];
const PAYMENT_STATUSES: AdminPaymentStatus[] = ["awaiting_payment", "paid", "refund_pending", "refunded", "unpaid"];
const FILTER_KEYS = ["status", "merchant_id", "payment_status", "date_from", "date_to"] as const;

const peso = (n: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(n);
const label = (s: string) => s.replace(/_/g, " ");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-PH") : "—");

function filtersFrom(params: URLSearchParams): AdminOrderFilters {
  const merchant = Number(params.get("merchant_id"));
  return {
    status: (params.get("status") as AdminOrderStatus) || undefined,
    merchant_id: merchant > 0 ? merchant : undefined,
    payment_status: (params.get("payment_status") as AdminPaymentStatus) || undefined,
    date_from: params.get("date_from") || undefined,
    date_to: params.get("date_to") || undefined,
  };
}

export default function AdminOrdersPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading orders…" />}>
      <AdminOrdersContent />
    </Suspense>
  );
}

function AdminOrdersContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const selectedId = Number(searchParams.get("order")) || null;
  const query = searchParams.toString();
  const filters = useMemo(() => filtersFrom(new URLSearchParams(query)), [query]);
  const filterKey = FILTER_KEYS.map((k) => filters[k] ?? "").join("|") + `|${page}`;

  const [orders, setOrders] = useState<AdminOrderSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [merchants, setMerchants] = useState<Merchant[]>([]);

  useEffect(() => {
    fetchAdminMerchants().then(setMerchants).catch(() => setMerchants([]));
  }, []);

  useEffect(() => {
    fetchAdminOrders(filters, page)
      .then((res) => {
        setOrders(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch(() => setError("Failed to load orders."))
      .finally(() => setLoadedKey(filterKey));
  }, [filters, page, filterKey]);

  const loading = loadedKey !== filterKey;

  const updateParams = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(query);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };
  // Changing a filter returns to page 1.
  const setFilter = (key: (typeof FILTER_KEYS)[number], value: string) =>
    updateParams({ [key]: value || null, page: null });
  const clearFilters = () => router.push(pathname);
  const hasFilters = FILTER_KEYS.some((k) => filters[k] !== undefined);

  if (loading && orders.length === 0 && !error) return <PageLoader label="Loading orders…" />;

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Orders <span className={styles.count}>{total}</span></h1>

      <div className={styles.filters}>
        <label className={styles.field}>
          <span>Status</span>
          <select value={filters.status ?? ""} onChange={(e) => setFilter("status", e.target.value)}>
            <option value="">All</option>
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>Payment</span>
          <select value={filters.payment_status ?? ""} onChange={(e) => setFilter("payment_status", e.target.value)}>
            <option value="">All</option>
            {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>Merchant</span>
          <select value={filters.merchant_id ?? ""} onChange={(e) => setFilter("merchant_id", e.target.value)}>
            <option value="">All</option>
            {merchants.map((m) => <option key={m.id} value={m.id}>{m.merchant_name}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>From</span>
          <input type="date" value={filters.date_from ?? ""} onChange={(e) => setFilter("date_from", e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>To</span>
          <input type="date" value={filters.date_to ?? ""} onChange={(e) => setFilter("date_to", e.target.value)} />
        </label>
        {hasFilters && (
          <button type="button" className={styles.clear} onClick={clearFilters}>Clear filters</button>
        )}
      </div>

      {error ? (
        <div className={styles.stateError}>{error}</div>
      ) : orders.length === 0 ? (
        <div className={styles.state}>No orders match these filters.</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Placed</th>
                <th>Buyer</th>
                <th>Merchant</th>
                <th>Status</th>
                <th>Payment</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr
                  key={o.id}
                  className={`${styles.row} ${selectedId === o.id ? styles.rowSelected : ""}`}
                  onClick={() => updateParams({ order: String(o.id) })}
                >
                  <td className={styles.mono}>
                    <button type="button" className={styles.linkButton} onClick={(e) => { e.stopPropagation(); updateParams({ order: String(o.id) }); }}>
                      #{o.id}
                    </button>
                  </td>
                  <td className={styles.mono}>{new Date(o.ordered_at).toLocaleDateString("en-PH")}</td>
                  <td>{o.buyer_name ?? o.buyer_email ?? <span className={styles.empty}>—</span>}</td>
                  <td>{o.merchant_name ?? <span className={styles.empty}>—</span>}</td>
                  <td><span className={styles.badge}>{label(o.status)}</span></td>
                  <td><span className={`${styles.badge} ${styles[`pay_${o.payment_status}`] ?? ""}`}>{label(o.payment_status)}</span></td>
                  <td className={styles.mono}>{peso(o.total_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={page}
        pageSize={ADMIN_PAGE_SIZE}
        total={total}
        disabled={loading}
        onPageChange={(next) => updateParams({ page: String(next) })}
      />

      {selectedId && <OrderDetailPanel orderId={selectedId} onClose={() => updateParams({ order: null })} />}
    </div>
  );
}

function OrderDetailPanel({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const [detail, setDetail] = useState<AdminOrderDetail | null>(null);
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAdminOrder(orderId)
      .then((d) => {
        setDetail(d);
        setError(null);
      })
      .catch(() => setError("Failed to load this order."))
      .finally(() => setLoadedId(orderId));
  }, [orderId]);

  const ready = loadedId === orderId;
  const d = ready ? detail : null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <aside className={styles.panel} role="dialog" aria-label={`Order #${orderId}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.panelHeader}>
          <h2>Order #{orderId}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>
        </div>

        {!ready ? (
          <p className={styles.state}>Loading…</p>
        ) : error || !d ? (
          <p className={styles.stateError}>{error ?? "Order not found."}</p>
        ) : (
          <>
            <section className={styles.section}>
              <dl className={styles.grid}>
                <dt>Status</dt><dd>{label(d.status)}</dd>
                <dt>Payment</dt><dd>{label(d.payment_status)}</dd>
                <dt>Buyer</dt><dd>{d.buyer_name ?? "—"}{d.buyer_email ? ` · ${d.buyer_email}` : ""}</dd>
                <dt>Merchant</dt><dd>{d.merchant_name ?? "—"}</dd>
                <dt>Placed</dt><dd>{when(d.ordered_at)}</dd>
                <dt>Total</dt><dd>{peso(d.total_price)} (delivery fee {peso(d.delivery_fee)})</dd>
                {d.notes && (<><dt>Notes</dt><dd>{d.notes}</dd></>)}
              </dl>
            </section>

            <section className={styles.section}>
              <h3>Items</h3>
              {d.items.length === 0 ? (
                <p className={styles.empty}>No items recorded.</p>
              ) : (
                <ul className={styles.list}>
                  {d.items.map((item, i) => (
                    <li key={i}>
                      {String(item.name ?? item.produce_name ?? `Item ${i + 1}`)}
                      {item.quantity !== undefined && ` × ${String(item.quantity)}`}
                      {typeof item.price === "number" && ` · ${peso(item.price)}`}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={styles.section}>
              <h3>Transactions</h3>
              {d.transactions.length === 0 ? (
                <p className={styles.empty}>No checkout attempts.</p>
              ) : (
                <ul className={styles.list}>
                  {d.transactions.map((t) => (
                    <li key={t.id}>
                      #{t.id} · {label(t.status)} · {peso(t.amount)} (fee {peso(t.platform_fee)}, merchant {peso(t.merchant_amount)})
                      <br />
                      <span className={styles.sub}>
                        Created {when(t.created_at)}{t.paid_at ? ` · paid ${when(t.paid_at)}` : ""}
                        {t.paymongo_payment_id ? ` · ${t.paymongo_payment_id}` : ""}
                        {t.refund_reference ? ` · refunded via ${label(t.refund_method ?? "")} (${t.refund_reference})` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={styles.section}>
              <h3>Shipment</h3>
              {d.shipment ? (
                <p>#{d.shipment.id} · {label(d.shipment.status)} · {d.shipment.stop_count} stops · shipped {when(d.shipment.shipped_at)}</p>
              ) : (
                <p className={styles.empty}>Not in a shipment yet.</p>
              )}
            </section>

            <section className={styles.section}>
              <h3>Delivery</h3>
              <dl className={styles.grid}>
                <dt>Address</dt><dd>{d.delivery.delivery_address ?? "—"}</dd>
                <dt>Requested</dt><dd>{d.delivery.requested_delivery_date ?? "—"}{d.delivery.delivery_window ? ` · ${d.delivery.delivery_window}` : ""}</dd>
                <dt>Est. arrival</dt><dd>{when(d.delivery.time_of_arrival)}</dd>
                <dt>Shipped</dt><dd>{when(d.delivery.shipped_at)}</dd>
                <dt>Delivered</dt><dd>{when(d.delivery.delivered_at)}</dd>
                <dt>Confirmed by</dt><dd>{d.delivery.delivery_confirmed_by ?? "Not confirmed"}</dd>
              </dl>
            </section>
          </>
        )}
      </aside>
    </div>
  );
}
