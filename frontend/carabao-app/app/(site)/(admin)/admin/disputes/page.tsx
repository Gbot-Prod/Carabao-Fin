"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ADMIN_PAGE_SIZE, fetchAdminDisputes, type AdminDispute, type AdminDisputeSort } from "@/util/api/admin";
import PageLoader from "@/components/PageLoader/PageLoader";
import styles from "../orders/page.module.css";
import own from "./page.module.css";
import PageHeader from "../../PageHeader";
import TablePanel, { TablePage, TableSearch, TableSegments, TableSort, type SortOption } from "../../TablePanel";
import SortHeader, { readSort, writeSort, type SortState } from "../../SortHeader";

const SORT_KEYS = ["order", "buyer", "farm", "amount", "delivered", "disputed", "decided"] as const;
const SORT_OPTIONS: SortOption<AdminDisputeSort>[] = [
  { key: "disputed", label: "Disputed", firstOrder: "desc" },
  { key: "decided", label: "Decided", firstOrder: "desc" },
  { key: "delivered", label: "Delivered", firstOrder: "desc" },
  { key: "amount", label: "Amount", firstOrder: "desc" },
  { key: "buyer", label: "Buyer" },
  { key: "farm", label: "Farm" },
  { key: "order", label: "Order", firstOrder: "desc" },
];

type State = "open" | "decided";

const peso = (n: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(n);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-PH") : "—");

/** "3 h" / "2 d": how long an open dispute has held the farm's payout. */
function waiting(iso: string): string {
  const hours = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000));
  return hours < 48 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

/**
 * Buyers who said "I did not get this" about a delivery the farm marked with
 * a drop-off photo (backend services/delivery_dispute.py). The payout waits
 * for the decision, made on the order (photos, farm's side, chat).
 */
export default function AdminDisputesPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading disputes…" />}>
      <DisputesContent />
    </Suspense>
  );
}

function DisputesContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state: State = searchParams.get("state") === "decided" ? "decided" : "open";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const q = searchParams.get("q")?.trim() ?? "";
  // No sort: open ones oldest first, decided ones newest decision first.
  const current = readSort<AdminDisputeSort>(searchParams, SORT_KEYS);
  const { sort, order } = current;
  const key = `${state}|${q}|${sort ?? ""}|${order}|${page}`;

  const [rows, setRows] = useState<AdminDispute[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAdminDisputes(state, page, ADMIN_PAGE_SIZE, { q: q || undefined, ...(sort ? { sort, order } : {}) })
      .then((res) => {
        setRows(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch(() => setError("Failed to load disputes."))
      .finally(() => setLoadedKey(`${state}|${q}|${sort ?? ""}|${order}|${page}`));
  }, [state, q, sort, order, page]);

  const loading = loadedKey !== key;

  const go = (next: { state?: State; q?: string; sort?: SortState<AdminDisputeSort>; page?: number }) => {
    const params = new URLSearchParams();
    const s = next.state ?? state;
    const nextQ = next.q ?? q;
    if (s === "decided") params.set("state", s);
    if (nextQ) params.set("q", nextQ);
    writeSort(params, next.sort ?? current);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };
  const onSort = (next: SortState<AdminDisputeSort>) => go({ sort: next, page: 1 });

  return (
    <TablePage>
      <PageHeader
        eyebrow="Money"
        title="Disputes"
        count={state === "open" && !loading ? total : undefined}
        description="Buyers who say a delivery did not arrive. The farm's payout is on hold until you decide. Open the order to see the drop-off photo, the farm's side and the chat, then release the payout or refund the buyer."
      />

      <TablePanel
        filters={
          <TableSegments
            label="Show disputes"
            options={[
              { value: "open" as State, label: "Waiting for a decision" },
              { value: "decided" as State, label: "Decided" },
            ]}
            value={state}
            // Each list starts in its own order.
            onChange={(s) => go({ state: s, sort: { sort: null, order: "asc" }, page: 1 })}
          />
        }
        sort={
          <TableSort
            options={state === "decided" ? SORT_OPTIONS : SORT_OPTIONS.filter((o) => o.key !== "decided")}
            current={current}
            onSort={onSort}
            defaultLabel={state === "open" ? "Oldest first (queue)" : "Newest decision first"}
          />
        }
        search={<TableSearch applied={q} onSearch={(v) => go({ q: v, page: 1 })} placeholder="#order, buyer or farm" label="Search disputes" />}
        message={
          loading && rows.length === 0
            ? "Loading disputes…"
            : error ??
              (rows.length === 0
                ? state === "open"
                  ? "No disputes are waiting for a decision."
                  : "No disputes decided yet."
                : null)
        }
        messageTone={!loading && error ? "error" : undefined}
        loading={loading}
        pagination={{ page, pageSize: ADMIN_PAGE_SIZE, total, onPageChange: (p) => go({ page: p }) }}
      >
        <table>
          <thead>
            <tr>
              <SortHeader label="Order" sortKey="order" current={current} onSort={onSort} firstOrder="desc" />
              <SortHeader label="Buyer" sortKey="buyer" current={current} onSort={onSort} />
              <SortHeader label="Farm" sortKey="farm" current={current} onSort={onSort} />
              <SortHeader label="Amount" sortKey="amount" current={current} onSort={onSort} firstOrder="desc" />
              <SortHeader label="Delivered" sortKey="delivered" current={current} onSort={onSort} firstOrder="desc" />
              <SortHeader label="Disputed" sortKey="disputed" current={current} onSort={onSort} firstOrder="desc" />
              <th>Farm&apos;s side</th>
              <th>{state === "open" ? "Waiting" : "Decision"}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.order_id}>
                <td className={styles.mono}>
                  {d.order_ref}
                  {d.delivery_flagged && <span className={`${styles.badge} ${styles.flag}`}>photo flagged</span>}
                </td>
                <td>
                  {d.buyer_name ?? d.buyer_email ?? "—"}
                  {d.buyer_name && d.buyer_email && <div className={styles.sub}>{d.buyer_email}</div>}
                </td>
                <td>{d.merchant_name ?? "—"}</td>
                <td className={styles.mono}>{peso(d.total_price)}</td>
                <td className={styles.mono}>{when(d.delivered_at)}</td>
                <td className={styles.mono}>{when(d.disputed_at)}</td>
                <td className={own.note}>
                  {d.merchant_note ? (
                    <>
                      <span className={own.noteText} title={d.merchant_note}>
                        {d.merchant_note}
                      </span>
                      <div className={styles.sub}>{when(d.merchant_noted_at)}</div>
                    </>
                  ) : (
                    <span className={styles.sub}>No reply yet</span>
                  )}
                </td>
                <td>
                  {state === "open" ? (
                    <span className={styles.mono}>{waiting(d.disputed_at)}</span>
                  ) : (
                    <>
                      <span className={`${styles.badge} ${d.resolution === "refund" ? own.refund : own.release}`}>
                        {d.resolution === "refund" ? "Buyer refunded" : "Payout released"}
                      </span>
                      <div className={styles.sub}>{when(d.resolved_at)}</div>
                    </>
                  )}
                </td>
                <td>
                  <Link className={styles.linkButton} href={`/admin/orders?order=${d.order_id}`}>
                    {state === "open" ? "Review" : "View"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TablePanel>
    </TablePage>
  );
}
