"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ADMIN_PAGE_SIZE,
  downloadAdminTransactionsCsv,
  fetchAdminMerchants,
  fetchAdminTransactions,
  type AdminTransaction,
  type AdminTransactionFilters,
  type AdminTransactionSort,
  type AdminTransactionTotals,
  type Merchant,
} from "@/util/api/admin";
import type { TransactionStatus } from "@/util/api/statuses";
import base from "../orders/page.module.css";
import styles from "./page.module.css";
import PageHeader, { HeaderButton } from "../../PageHeader";
import PageLoader from "@/components/PageLoader/PageLoader";
import { Download } from "lucide-react";
import TablePanel, {
  TablePage,
  TableChip,
  TableDate,
  TableFilter,
  TableSearch,
  TableSort,
  TableStat,
  type SortOption,
} from "../../TablePanel";
import SortHeader, { readSort, type SortState } from "../../SortHeader";

const TXN_STATUSES: TransactionStatus[] = ["pending", "paid", "failed", "expired", "refund_pending", "refunded"];
const FILTER_KEYS = ["status", "merchant_id", "date_from", "date_to", "q"] as const;
const SORT_KEYS = ["id", "created", "paid", "order", "buyer", "merchant", "status", "amount", "fee", "share"] as const;
/** The server's order when no sort is sent: newest first. */
const DEFAULT_SORT: SortState<AdminTransactionSort> = { sort: "created", order: "desc" };
const SORT_OPTIONS: SortOption<AdminTransactionSort>[] = [
  { key: "created", label: "Created", firstOrder: "desc" },
  { key: "paid", label: "Paid", firstOrder: "desc" },
  { key: "id", label: "ID", firstOrder: "desc" },
  { key: "order", label: "Order", firstOrder: "desc" },
  { key: "buyer", label: "Buyer" },
  { key: "merchant", label: "Merchant" },
  { key: "status", label: "Status" },
  { key: "amount", label: "Amount", firstOrder: "desc" },
  { key: "fee", label: "Fee", firstOrder: "desc" },
  { key: "share", label: "Merchant share", firstOrder: "desc" },
];

const peso = (n: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(n);
const label = (s: string) => s.replace(/_/g, " ");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-PH") : "—");

function filtersFrom(params: URLSearchParams): AdminTransactionFilters {
  const merchant = Number(params.get("merchant_id"));
  return {
    status: (params.get("status") as TransactionStatus) || undefined,
    merchant_id: merchant > 0 ? merchant : undefined,
    date_from: params.get("date_from") || undefined,
    date_to: params.get("date_to") || undefined,
    q: params.get("q") || undefined,
  };
}

export default function AdminTransactionsPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading transactions…" />}>
      <AdminTransactionsContent />
    </Suspense>
  );
}

function AdminTransactionsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const query = searchParams.toString();
  const filters = useMemo(() => filtersFrom(new URLSearchParams(query)), [query]);
  const current = readSort<AdminTransactionSort>(searchParams, SORT_KEYS, DEFAULT_SORT);
  const { sort, order } = current;
  const filterKey = FILTER_KEYS.map((k) => filters[k] ?? "").join("|") + `|${sort}|${order}|${page}`;
  // The list and the CSV export use the same filters and order.
  const listQuery = useMemo(() => ({ ...filters, sort: sort ?? undefined, order }), [filters, sort, order]);

  const [rows, setRows] = useState<AdminTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState<AdminTransactionTotals | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    fetchAdminMerchants().then(setMerchants).catch(() => setMerchants([]));
  }, []);

  useEffect(() => {
    fetchAdminTransactions(listQuery, page)
      .then((res) => {
        setRows(res.items);
        setTotal(res.total);
        setTotals(res.totals);
        setError(null);
      })
      .catch(() => setError("Failed to load transactions."))
      .finally(() => setLoadedKey(filterKey));
  }, [listQuery, page, filterKey]);

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
  const setFilter = (key: (typeof FILTER_KEYS)[number], value: string) =>
    updateParams({ [key]: value || null, page: null });
  const clearFilters = () => router.push(pathname);
  const onSort = (next: SortState<AdminTransactionSort>) => {
    const isDefault = next.sort === DEFAULT_SORT.sort && next.order === DEFAULT_SORT.order;
    updateParams({ sort: isDefault ? null : next.sort, order: isDefault ? null : next.order, page: null });
  };
  const hasFilters = FILTER_KEYS.some((k) => filters[k] !== undefined);

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadAdminTransactionsCsv(listQuery);
    } catch {
      setExportError("Export failed. Try again.");
    } finally {
      setExporting(false);
    }
  };

  const firstLoad = loading && rows.length === 0 && !error;

  return (
    <TablePage>
      <PageHeader eyebrow="Money" title="Transactions" count={total} description="Checkout payments through PayMongo, with fees and each merchant's share.">
        <HeaderButton
          onClick={handleExport}
          disabled={exporting || total === 0}
          icon={<Download size={15} strokeWidth={2} aria-hidden="true" />}
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </HeaderButton>
      </PageHeader>
      <TablePanel
        activeFilters={FILTER_KEYS.filter((k) => k !== "q" && filters[k] !== undefined).length}
        summary={
          totals &&
          !error && (
            <>
              <TableStat label="Gross amount" value={peso(totals.amount)} />
              <TableStat label="Platform fees" value={peso(totals.platform_fee)} />
              <TableStat label="Merchant share" value={peso(totals.merchant_amount)} />
            </>
          )
        }
        notice={exportError ? { text: exportError, tone: "error", onDismiss: () => setExportError(null) } : null}
        sort={<TableSort options={SORT_OPTIONS} current={current} onSort={onSort} defaultLabel="Newest first" />}
        filters={
          <>
            <TableFilter label="Status" value={filters.status ?? ""} onChange={(v) => setFilter("status", v)}>
              <option value="">All</option>
              {TXN_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </TableFilter>
            <TableFilter label="Merchant" value={String(filters.merchant_id ?? "")} onChange={(v) => setFilter("merchant_id", v)}>
              <option value="">All</option>
              {merchants.map((m) => <option key={m.id} value={m.id}>{m.merchant_name}</option>)}
            </TableFilter>
            <TableDate label="Created from" value={filters.date_from ?? ""} onChange={(v) => setFilter("date_from", v)} />
            <TableDate label="To" value={filters.date_to ?? ""} onChange={(v) => setFilter("date_to", v)} />
            {hasFilters && <TableChip onClear={clearFilters}>Clear filters</TableChip>}
          </>
        }
        search={
          <TableSearch
            applied={filters.q ?? ""}
            onSearch={(v) => setFilter("q", v)}
            placeholder="PayMongo ID, #order or buyer"
            label="Search transactions"
          />
        }
        message={firstLoad ? "Loading transactions…" : error ?? (rows.length === 0 ? "No transactions match these filters." : null)}
        messageTone={error ? "error" : undefined}
        loading={loading}
        pagination={{ page, pageSize: ADMIN_PAGE_SIZE, total, onPageChange: (next) => updateParams({ page: String(next) }) }}
      >
          <table>
            <thead>
              <tr>
                <SortHeader label="ID" sortKey="id" current={current} onSort={onSort} firstOrder="desc" />
                <SortHeader label="Created" sortKey="created" current={current} onSort={onSort} firstOrder="desc" />
                <SortHeader label="Paid" sortKey="paid" current={current} onSort={onSort} firstOrder="desc" />
                <SortHeader label="Order" sortKey="order" current={current} onSort={onSort} firstOrder="desc" />
                <SortHeader label="Buyer" sortKey="buyer" current={current} onSort={onSort} />
                <SortHeader label="Merchant" sortKey="merchant" current={current} onSort={onSort} />
                <SortHeader label="Status" sortKey="status" current={current} onSort={onSort} />
                <SortHeader label="Amount" sortKey="amount" current={current} onSort={onSort} firstOrder="desc" />
                <SortHeader label="Fee" sortKey="fee" current={current} onSort={onSort} firstOrder="desc" />
                <SortHeader label="Merchant share" sortKey="share" current={current} onSort={onSort} firstOrder="desc" />
                <th>PayMongo payment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className={base.mono}>#{t.id}</td>
                  <td className={base.mono}>{when(t.created_at)}</td>
                  <td className={base.mono}>{when(t.paid_at)}</td>
                  <td>
                    <Link className={base.linkButton} href={`/admin/orders?order=${t.order_id}`}>#{t.order_id}</Link>
                  </td>
                  <td>{t.buyer_name ?? t.buyer_email ?? <span className={base.empty}>—</span>}</td>
                  <td>{t.merchant_name ?? <span className={base.empty}>—</span>}</td>
                  <td>
                    <span className={`${base.badge} ${styles[`txn_${t.status}`] ?? ""}`}>{label(t.status)}</span>
                    {t.refund_reference && (
                      <div className={styles.ref}>{label(t.refund_method ?? "")} · {t.refund_reference}</div>
                    )}
                  </td>
                  <td className={base.mono}>{peso(t.amount)}</td>
                  <td className={base.mono}>{peso(t.platform_fee)}</td>
                  <td className={base.mono}>{peso(t.merchant_amount)}</td>
                  <td className={styles.ref}>{t.paymongo_payment_id ?? <span className={base.empty}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
      </TablePanel>
    </TablePage>
  );
}
