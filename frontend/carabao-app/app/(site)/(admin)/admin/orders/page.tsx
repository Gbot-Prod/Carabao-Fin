"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ADMIN_PAGE_SIZE,
  cancelAdminOrder,
  decideAdminDispute,
  fetchAdminMerchants,
  fetchAdminOrder,
  fetchAdminOrders,
  fetchAdminProofPhoto,
  type AdminOrderDetail,
  type AdminOrderFilters,
  type AdminOrderSort,
  type AdminOrderStatus,
  type AdminOrderSummary,
  type AdminPaymentStatus,
  type Merchant,
} from "@/util/api/admin";
import styles from "./page.module.css";
import TablePanel, { TablePage, TableChip, TableDate, TableFilter, TableSearch, TableSort, type SortOption } from "../../TablePanel";
import SortHeader, { readSort, type SortState } from "../../SortHeader";
import PageHeader from "../../PageHeader";
import PageLoader from "@/components/PageLoader/PageLoader";
import OrderChat from "@/components/OrderChat/OrderChat";
import ProofPhoto from "@/components/ProofPhoto/ProofPhoto";
import getApiErrorMessage from "@/util/errorHelper";

const ORDER_STATUSES: AdminOrderStatus[] = ["pending", "processing", "shipped", "out_for_delivery", "delivered", "cancelled", "payment_mismatch"];
const PAYMENT_STATUSES: AdminPaymentStatus[] = ["awaiting_payment", "paid", "refund_pending", "refunded", "unpaid"];
// Orders an admin may still cancel (mirrors ACTIVE_ORDER_STATUSES in the backend).
const CANCELLABLE: AdminOrderStatus[] = ["pending", "processing", "shipped", "out_for_delivery"];
const FILTER_KEYS = ["status", "merchant_id", "payment_status", "date_from", "date_to", "delivery", "q"] as const;
const SORT_KEYS = ["id", "placed", "buyer", "merchant", "status", "total"] as const;
/** The server's order when no sort is sent: newest first. */
const DEFAULT_SORT: SortState<AdminOrderSort> = { sort: "placed", order: "desc" };
const SORT_OPTIONS: SortOption<AdminOrderSort>[] = [
  { key: "placed", label: "Placed", firstOrder: "desc" },
  { key: "id", label: "ID", firstOrder: "desc" },
  { key: "buyer", label: "Buyer" },
  { key: "merchant", label: "Merchant" },
  { key: "status", label: "Status" },
  { key: "total", label: "Total", firstOrder: "desc" },
];
// ORDER_PROOF_PHOTOS_PLAN.md: proof photo kinds and flags, as admins read them.
const PROOF_LABELS: Record<string, string> = {
  packing: "Packing",
  dropoff: "Drop-off",
  attempt: "Failed drop-off",
};
const FLAG_LABELS: Record<string, string> = {
  gps_far: "Far from the buyer pin",
  gps_missing: "No GPS from the phone",
  pin_missing: "Order has no pin",
  hash_reused: "Same photo on another order",
  pin_reported: "Rider reported the pin",
};

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
    delivery: (params.get("delivery") as AdminOrderFilters["delivery"]) || undefined,
    q: params.get("q")?.trim() || undefined,
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
  const current = readSort<AdminOrderSort>(searchParams, SORT_KEYS, DEFAULT_SORT);
  const { sort, order } = current;
  const filterKey = FILTER_KEYS.map((k) => filters[k] ?? "").join("|") + `|${sort}|${order}|${page}`;

  const [orders, setOrders] = useState<AdminOrderSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [merchants, setMerchants] = useState<Merchant[]>([]);

  useEffect(() => {
    fetchAdminMerchants().then(setMerchants).catch(() => setMerchants([]));
  }, []);

  useEffect(() => {
    fetchAdminOrders({ ...filters, sort: sort ?? undefined, order }, page)
      .then((res) => {
        setOrders(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch(() => setError("Failed to load orders."))
      .finally(() => setLoadedKey(filterKey));
  }, [filters, sort, order, page, filterKey]);

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
  const onSort = (next: SortState<AdminOrderSort>) => {
    const isDefault = next.sort === DEFAULT_SORT.sort && next.order === DEFAULT_SORT.order;
    updateParams({
      sort: isDefault ? null : next.sort,
      order: isDefault ? null : next.order,
      page: null,
    });
  };
  const clearFilters = () => router.push(pathname);
  const hasFilters = FILTER_KEYS.some((k) => filters[k] !== undefined);

  const firstLoad = loading && orders.length === 0 && !error;

  return (
    <TablePage>
      <PageHeader eyebrow="Money" title="Orders" count={total} description="Every order across all merchants. Click a row for details." />

      <TablePanel
        activeFilters={FILTER_KEYS.filter((k) => k !== "q" && filters[k] !== undefined).length}
        filters={
          <>
            <TableFilter label="Status" value={filters.status ?? ""} onChange={(v) => setFilter("status", v)}>
              <option value="">All</option>
              {ORDER_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </TableFilter>
            <TableFilter label="Payment" value={filters.payment_status ?? ""} onChange={(v) => setFilter("payment_status", v)}>
              <option value="">All</option>
              {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </TableFilter>
            <TableFilter label="Merchant" value={String(filters.merchant_id ?? "")} onChange={(v) => setFilter("merchant_id", v)}>
              <option value="">All</option>
              {merchants.map((m) => <option key={m.id} value={m.id}>{m.merchant_name}</option>)}
            </TableFilter>
            <TableFilter label="Delivery" value={filters.delivery ?? ""} onChange={(v) => setFilter("delivery", v)}>
              <option value="">All</option>
              <option value="flagged">Flagged photo</option>
              <option value="disputed">Disputed, not decided</option>
            </TableFilter>
            <TableDate label="From" value={filters.date_from ?? ""} onChange={(v) => setFilter("date_from", v)} />
            <TableDate label="To" value={filters.date_to ?? ""} onChange={(v) => setFilter("date_to", v)} />
            {hasFilters && <TableChip onClear={clearFilters}>Clear filters</TableChip>}
          </>
        }
        sort={<TableSort options={SORT_OPTIONS} current={current} onSort={onSort} defaultLabel="Newest first" />}
        search={<TableSearch applied={filters.q ?? ""} onSearch={(v) => setFilter("q", v)} placeholder="#order, buyer or merchant" label="Search orders" />}
        message={firstLoad ? "Loading orders…" : error ?? (orders.length === 0 ? "No orders match these filters." : null)}
        messageTone={error ? "error" : undefined}
        loading={loading}
        pagination={{ page, pageSize: ADMIN_PAGE_SIZE, total, onPageChange: (next) => updateParams({ page: String(next) }) }}
      >
          <table>
            <thead>
              <tr>
                <SortHeader label="ID" sortKey="id" current={current} onSort={onSort} firstOrder="desc" />
                <SortHeader label="Placed" sortKey="placed" current={current} onSort={onSort} firstOrder="desc" />
                <SortHeader label="Buyer" sortKey="buyer" current={current} onSort={onSort} />
                <SortHeader label="Merchant" sortKey="merchant" current={current} onSort={onSort} />
                <SortHeader label="Status" sortKey="status" current={current} onSort={onSort} />
                <th>Payment</th>
                <SortHeader label="Total" sortKey="total" current={current} onSort={onSort} firstOrder="desc" />
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
                  <td>
                    <span className={styles.badge}>{label(o.status)}</span>
                    {o.dispute_open && <span className={`${styles.badge} ${styles.flag}`}>disputed</span>}
                    {o.delivery_flagged && <span className={`${styles.badge} ${styles.flag}`}>flagged</span>}
                  </td>
                  <td><span className={`${styles.badge} ${styles[`pay_${o.payment_status}`] ?? ""}`}>{label(o.payment_status)}</span></td>
                  <td className={styles.mono}>{peso(o.total_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
      </TablePanel>

      {selectedId && <OrderDetailPanel orderId={selectedId} onClose={() => updateParams({ order: null })} />}
    </TablePage>
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
                <dt>Est. arrival</dt><dd>{when(d.delivery.time_of_arrival)}</dd>
                <dt>Shipped</dt><dd>{when(d.delivery.shipped_at)}</dd>
                <dt>Delivered</dt><dd>{when(d.delivery.delivered_at)}</dd>
                <dt>Confirmed by</dt><dd>{d.delivery.delivery_confirmed_by ?? "Not confirmed"}</dd>
                {d.delivery.cancel_reason && (<><dt>Cancel reason</dt><dd>{d.delivery.cancel_reason}</dd></>)}
                {d.delivery.dispute_until && (<><dt>Dispute window</dt><dd>until {when(d.delivery.dispute_until)}</dd></>)}
                {d.delivery.delivery_buyer_confirmed_at && (<><dt>Buyer confirmed</dt><dd>{when(d.delivery.delivery_buyer_confirmed_at)}</dd></>)}
                {d.delivery.delivery_disputed_at && (<><dt>Buyer disputed</dt><dd>{when(d.delivery.delivery_disputed_at)}</dd></>)}
                {d.delivery.delivery_disputed_at && (
                  <>
                    <dt>Farm&apos;s side</dt>
                    <dd>
                      {d.delivery.dispute_merchant_note ? (
                        <>
                          {d.delivery.dispute_merchant_note}
                          <div className={styles.sub}>{when(d.delivery.dispute_merchant_noted_at ?? null)}</div>
                        </>
                      ) : (
                        <span className={styles.sub}>The farm has not replied.</span>
                      )}
                    </dd>
                  </>
                )}
                {d.delivery.dispute_resolution && (
                  <><dt>Decision</dt><dd>{d.delivery.dispute_resolution} · {when(d.delivery.dispute_resolved_at ?? null)}</dd></>
                )}
              </dl>
            </section>

            <ProofSection detail={d} />

            {d.dispute_open && <DisputeDecisionSection orderId={d.id} onDecided={setDetail} />}

            {CANCELLABLE.includes(d.status as AdminOrderStatus) && (
              <CancelOrderSection orderId={d.id} onCancelled={setDetail} />
            )}

            {/* Admins can read the buyer-farm chat and join in (CH1b). */}
            <OrderChat orderId={d.id} />
          </>
        )}
      </aside>
    </div>
  );
}

function CancelOrderSection({
  orderId,
  onCancelled,
}: {
  orderId: number;
  onCancelled: (detail: AdminOrderDetail) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (reason.trim().length < 3) {
      setError("Give a reason. The buyer sees it.");
      return;
    }
    if (!window.confirm("Cancel this order? A paid order goes to the refund queue.")) return;
    setBusy(true);
    setError(null);
    try {
      onCancelled(await cancelAdminOrder(orderId, reason.trim()));
    } catch (err) {
      setError(getApiErrorMessage(err) ?? "Could not cancel the order.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.section}>
      <h3>Cancel order</h3>
      <p className={styles.sub}>Use this when the farm cannot complete the order. The buyer is told the reason.</p>
      <textarea
        className={styles.cancelReason}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={300}
        rows={2}
        placeholder="Reason, for example: farm cannot deliver"
        aria-label="Cancel reason"
      />
      {error && <p className={styles.stateError}>{error}</p>}
      <button type="button" className={styles.cancelButton} onClick={submit} disabled={busy}>
        {busy ? "Cancelling…" : "Cancel order"}
      </button>
    </section>
  );
}

function ProofSection({ detail }: { detail: AdminOrderDetail }) {
  const photos = detail.proof_photos ?? [];
  return (
    <section className={styles.section}>
      <h3>Proof photos</h3>
      {photos.length === 0 ? (
        <p className={styles.empty}>No proof photos.</p>
      ) : (
        <div className={styles.proofGrid}>
          {photos.map((p) => {
            const caption = (
              <>
                <strong>{PROOF_LABELS[p.kind] ?? p.kind}</strong> · {when(p.received_at)}
                {p.distance_m !== null && <> · {p.distance_m} m from the pin</>}
                {p.flags.length > 0 && (
                  <span className={styles.flagList}>{p.flags.map((f) => FLAG_LABELS[f] ?? f).join(", ")}</span>
                )}
              </>
            );
            return p.deleted ? (
              <p key={p.kind} className={styles.sub}>{caption} · image deleted after 90 days</p>
            ) : (
              <ProofPhoto
                key={p.kind}
                orderId={detail.id}
                kind={p.kind}
                load={fetchAdminProofPhoto}
                alt={`${PROOF_LABELS[p.kind] ?? p.kind} photo of order #${detail.id}`}
                caption={caption}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function DisputeDecisionSection({
  orderId,
  onDecided,
}: {
  orderId: number;
  onDecided: (detail: AdminOrderDetail) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: "release" | "refund") => {
    const question =
      decision === "release"
        ? "Release the payout? The farm can then claim the earnings of this order."
        : "Refund the buyer? The payment goes to the refund queue and the farm is not paid.";
    if (!window.confirm(question)) return;
    setBusy(true);
    setError(null);
    try {
      onDecided(await decideAdminDispute(orderId, decision, note.trim()));
    } catch (err) {
      setError(getApiErrorMessage(err) ?? "Could not save the decision.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.section}>
      <h3>Disputed delivery</h3>
      <p className={styles.sub}>
        The buyer says the order did not arrive. The payout is frozen. Check the drop-off photo, the distance and the
        flags, then decide.
      </p>
      <textarea
        className={styles.cancelReason}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        rows={2}
        placeholder="Note for the audit log (optional)"
        aria-label="Decision note"
      />
      {error && <p className={styles.stateError}>{error}</p>}
      <div className={styles.decisionRow}>
        <button type="button" className={styles.releaseButton} onClick={() => void decide("release")} disabled={busy}>
          Release payout
        </button>
        <button type="button" className={styles.cancelButton} onClick={() => void decide("refund")} disabled={busy}>
          Refund buyer
        </button>
      </div>
    </section>
  );
}
