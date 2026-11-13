"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ADMIN_PAGE_SIZE,
  fetchAdminProduce,
  hideProduce,
  unhideProduce,
  type AdminProduce,
} from "@/util/api/admin";
import getApiErrorMessage from "@/util/errorHelper";
import Pagination from "../../Pagination";
import PageLoader from "@/components/PageLoader/PageLoader";
import styles from "../orders/page.module.css";
import suspend from "../../suspend.module.css";
import PageHeader from "../../PageHeader";

type Visibility = "" | "visible" | "hidden";

export default function AdminListingsPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading listings…" />}>
      <ListingsContent />
    </Suspense>
  );
}

function ListingsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const visibility = (searchParams.get("show") as Visibility) || "";
  const q = searchParams.get("q") || "";
  const key = `${visibility}|${q}|${page}`;

  const [rows, setRows] = useState<AdminProduce[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(q);
  const [busy, setBusy] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);

  useEffect(() => {
    const hidden = visibility === "hidden" ? true : visibility === "visible" ? false : undefined;
    fetchAdminProduce({ hidden, q: q || undefined }, page)
      .then((res) => {
        setRows(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch(() => setError("Failed to load listings."))
      .finally(() => setLoadedKey(`${visibility}|${q}|${page}`));
  }, [visibility, q, page]);

  const loading = loadedKey !== key;

  const go = (next: { show?: Visibility; q?: string; page?: number }) => {
    const params = new URLSearchParams();
    const show = next.show ?? visibility;
    const query = next.q ?? q;
    if (show) params.set("show", show);
    if (query) params.set("q", query);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    go({ q: search.trim(), page: 1 });
  };

  const replace = (updated: AdminProduce) =>
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));

  const hide = async (row: AdminProduce) => {
    const reason = window.prompt(
      `Hide "${row.name}"? Buyers won't see or be able to order it. The merchant sees your reason.\n\nReason:`,
    );
    if (reason === null) return;
    if (!reason.trim()) {
      setRowError({ id: row.id, message: "A reason is required." });
      return;
    }
    setBusy(row.id);
    setRowError(null);
    try {
      replace(await hideProduce(row.id, reason.trim()));
    } catch (err) {
      setRowError({ id: row.id, message: getApiErrorMessage(err) ?? "Could not hide the listing." });
    } finally {
      setBusy(null);
    }
  };

  const unhide = async (row: AdminProduce) => {
    if (!window.confirm(`Show "${row.name}" to buyers again?`)) return;
    setBusy(row.id);
    setRowError(null);
    try {
      replace(await unhideProduce(row.id));
    } catch (err) {
      setRowError({ id: row.id, message: getApiErrorMessage(err) ?? "Could not unhide the listing." });
    } finally {
      setBusy(null);
    }
  };

  if (loading && rows.length === 0 && !error) return <PageLoader label="Loading listings…" />;

  return (
    <div className={styles.page}>
      <PageHeader eyebrow="People" title="Listings" count={total} description="Products merchants have posted. Hide anything that shouldn't be shown to buyers." />

      <div className={styles.filters}>
        <label className={styles.field}>
          <span>Show</span>
          <select value={visibility} onChange={(e) => go({ show: e.target.value as Visibility, page: 1 })}>
            <option value="">All listings</option>
            <option value="visible">Visible to buyers</option>
            <option value="hidden">Hidden by admin</option>
          </select>
        </label>
        <form onSubmit={onSearch} className={styles.field}>
          <span>Search by name</span>
          <input type="search" aria-label="Search listings by name" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. talong" maxLength={100} />
        </form>
      </div>

      {error ? (
        <div className={styles.stateError}>{error}</div>
      ) : rows.length === 0 ? (
        <div className={styles.state}>No listings match.</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Listing</th>
                <th>Merchant</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Best before</th>
                <th>Moderation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className={styles.mono}>{row.id}</td>
                  <td>
                    {row.name}
                    {row.category && <div className={styles.sub}>{row.category}</div>}
                  </td>
                  <td>{row.merchant_name ?? "—"}</td>
                  <td className={styles.mono}>₱{row.price} / {row.unit}</td>
                  <td className={styles.mono}>{row.stock_quantity}</td>
                  <td className={styles.mono}>{row.best_before ?? "—"}</td>
                  <td>
                    <div className={suspend.wrap}>
                      {row.hidden_at ? (
                        <>
                          <span className={suspend.suspended}>Hidden</span>
                          <button type="button" className={suspend.action} disabled={busy === row.id} onClick={() => void unhide(row)}>
                            Unhide
                          </button>
                          {row.hidden_reason && <span className={suspend.reason}>{row.hidden_reason}</span>}
                        </>
                      ) : (
                        <>
                          <span className={suspend.active}>Visible</span>
                          <button
                            type="button"
                            className={`${suspend.action} ${suspend.danger}`}
                            disabled={busy === row.id}
                            onClick={() => void hide(row)}
                          >
                            Hide
                          </button>
                        </>
                      )}
                      {rowError?.id === row.id && <span className={suspend.error} role="alert">{rowError.message}</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} total={total} disabled={loading} onPageChange={(p) => go({ page: p })} />
    </div>
  );
}
