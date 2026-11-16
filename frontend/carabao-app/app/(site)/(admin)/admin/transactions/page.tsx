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
  type AdminTransactionTotals,
  type Merchant,
} from "@/util/api/admin";
import type { TransactionStatus } from "@/util/api/statuses";
import Pagination from "../../Pagination";
import base from "../orders/page.module.css";
import styles from "./page.module.css";
import PageHeader from "../../PageHeader";
import PageLoader from "@/components/PageLoader/PageLoader";
import { Download } from "lucide-react";

const TXN_STATUSES: TransactionStatus[] = ["pending", "paid", "failed", "expired", "refund_pending", "refunded"];
const FILTER_KEYS = ["status", "merchant_id", "date_from", "date_to", "q"] as const;

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
  const filterKey = FILTER_KEYS.map((k) => filters[k] ?? "").join("|") + `|${page}`;

  const [rows, setRows] = useState<AdminTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState<AdminTransactionTotals | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [search, setSearch] = useState(filters.q ?? "");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    fetchAdminMerchants().then(setMerchants).catch(() => setMerchants([]));
  }, []);

  useEffect(() => {
    fetchAdminTransactions(filters, page)
      .then((res) => {
        setRows(res.items);
        setTotal(res.total);
        setTotals(res.totals);
        setError(null);
      })
      .catch(() => setError("Failed to load transactions."))
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
  const setFilter = (key: (typeof FILTER_KEYS)[number], value: string) =>
    updateParams({ [key]: value || null, page: null });
  const clearFilters = () => {
    setSearch("");
    router.push(pathname);
  };
  const hasFilters = FILTER_KEYS.some((k) => filters[k] !== undefined);

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadAdminTransactionsCsv(filters);
    } catch {
      setExportError("Export failed. Try again.");
    } finally {
      setExporting(false);
    }
  };

  if (loading && rows.length === 0 && !error) return <PageLoader label="Loading transactions…" />;

  return (
    <div className={base.page}>
      <PageHeader eyebrow="Money" title="Transactions" count={total} description="Checkout payments through PayMongo, with fees and each merchant's share.">
        <button type="button" className={styles.export} onClick={handleExport} disabled={exporting || total === 0}>
          <Download size={16} strokeWidth={1.9} />
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </PageHeader>
      {exportError && <p className={styles.exportError}>{exportError}</p>}

      <div className={base.filters}>
        <form
          className={base.field}
          onSubmit={(e) => {
            e.preventDefault();
            setFilter("q", search.trim());
          }}
        >
          <span>Search</span>
          <div className={styles.search}>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="PayMongo ID, #order, buyer email"
              aria-label="Search transactions"
            />
            <button type="submit">Search</button>
          </div>
        </form>
        <label className={base.field}>
          <span>Status</span>
          <select value={filters.status ?? ""} onChange={(e) => setFilter("status", e.target.value)}>
            <option value="">All</option>
            {TXN_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </label>
        <label className={base.field}>
          <span>Merchant</span>
          <select value={filters.merchant_id ?? ""} onChange={(e) => setFilter("merchant_id", e.target.value)}>
            <option value="">All</option>
            {merchants.map((m) => <option key={m.id} value={m.id}>{m.merchant_name}</option>)}
          </select>
        </label>
        <label className={base.field}>
          <span>Created from</span>
          <input type="date" value={filters.date_from ?? ""} onChange={(e) => setFilter("date_from", e.target.value)} />
        </label>
        <label className={base.field}>
          <span>To</span>
          <input type="date" value={filters.date_to ?? ""} onChange={(e) => setFilter("date_to", e.target.value)} />
        </label>
        {hasFilters && (
          <button type="button" className={base.clear} onClick={clearFilters}>Clear filters</button>
        )}
      </div>

      {totals && !error && (
        <div className={styles.totals} aria-label="Totals for the current filters">
          <div className={styles.tile}>
            <span className={styles.tileLabel}>Gross amount</span>
            <span className={styles.tileValue}>{peso(totals.amount)}</span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileLabel}>Platform fees</span>
            <span className={styles.tileValue}>{peso(totals.platform_fee)}</span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileLabel}>Merchant share</span>
            <span className={styles.tileValue}>{peso(totals.merchant_amount)}</span>
          </div>
        </div>
      )}

      {error ? (
        <div className={base.stateError}>{error}</div>
      ) : rows.length === 0 ? (
        <div className={base.state}>No transactions match these filters.</div>
      ) : (
        <div className={base.tableWrap}>
          <table className={base.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Created</th>
                <th>Paid</th>
                <th>Order</th>
                <th>Buyer</th>
                <th>Merchant</th>
                <th>Status</th>
                <th>Amount</th>
                <th>Fee</th>
                <th>Merchant share</th>
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
        </div>
      )}

      <Pagination
        page={page}
        pageSize={ADMIN_PAGE_SIZE}
        total={total}
        disabled={loading}
        onPageChange={(next) => updateParams({ page: String(next) })}
      />
    </div>
  );
}
