"use client";

import { Fragment, Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ADMIN_PAGE_SIZE,
  fetchAdminProduce,
  hideProduce,
  unhideProduce,
  type AdminProduce,
} from "@/util/api/admin";
import getApiErrorMessage from "@/util/errorHelper";
import Pagination from "@/components/Pagination/Pagination";
import PageLoader from "@/components/PageLoader/PageLoader";
import styles from "../orders/page.module.css";
import suspend from "../../suspend.module.css";
import PageHeader from "../../PageHeader";
import ExpandToggle, { formatDate, formatDateTime } from "../../ExpandToggle";
import details from "../../details.module.css";

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
  const merchantParam = Number(searchParams.get("merchant"));
  const merchantId = Number.isInteger(merchantParam) && merchantParam > 0 ? merchantParam : undefined;
  const key = `${visibility}|${q}|${merchantId ?? ""}|${page}`;

  const [rows, setRows] = useState<AdminProduce[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(q);
  const [busy, setBusy] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => {
    const hidden = visibility === "hidden" ? true : visibility === "visible" ? false : undefined;
    fetchAdminProduce({ hidden, q: q || undefined, merchant_id: merchantId }, page)
      .then((res) => {
        setRows(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch(() => setError("Failed to load listings."))
      .finally(() => setLoadedKey(`${visibility}|${q}|${merchantId ?? ""}|${page}`));
  }, [visibility, q, merchantId, page]);

  const loading = loadedKey !== key;

  const go = (next: { show?: Visibility; q?: string; merchant?: number | null; page?: number }) => {
    const params = new URLSearchParams();
    const show = next.show ?? visibility;
    const query = next.q ?? q;
    const merchant = next.merchant === null ? undefined : (next.merchant ?? merchantId);
    if (show) params.set("show", show);
    if (query) params.set("q", query);
    if (merchant) params.set("merchant", String(merchant));
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
        {merchantId && (
          <button type="button" className={styles.clear} onClick={() => go({ merchant: null, page: 1 })}>
            Merchant #{merchantId} only · Clear
          </button>
        )}
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
                <th className={details.toggleCell} aria-label="Details" />
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
              {rows.map((row) => {
                const open = expanded.has(row.id);
                const detailId = `listing-details-${row.id}`;
                return (
                <Fragment key={row.id}>
                <tr className={open ? details.openRow : undefined}>
                  <td className={details.toggleCell}>
                    <ExpandToggle expanded={open} controls={detailId} label={row.name ?? `listing ${row.id}`} onToggle={() => toggle(row.id)} />
                  </td>
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
                {open && (
                  <tr id={detailId} className={details.detailRow}>
                    <td colSpan={8}>
                      <ListingDetails row={row} />
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} total={total} disabled={loading} onPageChange={(p) => go({ page: p })} />
    </div>
  );
}

function ListingDetails({ row }: { row: AdminProduce }) {
  const harvest = formatDate(row.harvest_date);
  const bestBefore = formatDate(row.best_before);
  const hiddenAt = formatDateTime(row.hidden_at);
  const tiers = [...(row.price_tiers ?? [])].sort((a, b) => a.min_qty - b.min_qty);
  const dash = <span className={details.muted}>—</span>;

  return (
    <div className={details.panel}>
      {row.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.image_url} alt={row.name ? `Photo of ${row.name}` : "Listing photo"} className={details.photo} />
      ) : (
        <div className={`${details.photo} ${details.photoEmpty}`}>No photo</div>
      )}

      <div className={details.section}>
        <h3 className={details.sectionTitle}>Description</h3>
        {row.description?.trim() ? (
          <p className={details.text}>{row.description}</p>
        ) : (
          <p className={`${details.text} ${details.muted}`}>The merchant did not add a description.</p>
        )}
      </div>

      <div className={details.section}>
        <h3 className={details.sectionTitle}>Listing details</h3>
        <dl className={details.grid}>
          <div>
            <dt>Category</dt>
            <dd>{row.category ?? dash}</dd>
          </div>
          <div>
            <dt>Sold per</dt>
            <dd>
              {row.unit_quantity} {row.unit}
            </dd>
          </div>
          <div>
            <dt>Base price</dt>
            <dd>
              ₱{row.price} / {row.unit}
            </dd>
          </div>
          <div>
            <dt>Minimum order</dt>
            <dd>
              {row.min_order_qty} unit{row.min_order_qty === 1 ? "" : "s"}
            </dd>
          </div>
          <div>
            <dt>Stock</dt>
            <dd>{row.stock_quantity === 0 ? <span className={details.badge}>Out of stock</span> : row.stock_quantity}</dd>
          </div>
          <div>
            <dt>Harvested</dt>
            <dd>{harvest ?? dash}</dd>
          </div>
          <div>
            <dt>Best before</dt>
            <dd>{bestBefore ?? dash}</dd>
          </div>
          <div>
            <dt>Merchant</dt>
            <dd>
              {row.merchant_name ?? `#${row.merchant_id}`}{" "}
              <Link href={`/admin/listings?merchant=${row.merchant_id}`} className={details.link}>
                All listings
              </Link>
            </dd>
          </div>
          <div className={details.wide}>
            <dt>Bulk pricing</dt>
            <dd>
              {tiers.length === 0 ? (
                dash
              ) : (
                <ul className={details.tiers}>
                  {tiers.map((t) => (
                    <li key={t.min_qty}>
                      {t.min_qty}+ units: ₱{t.unit_price} / {row.unit}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
          {row.hidden_at && (
            <div className={details.wide}>
              <dt>Hidden</dt>
              <dd>
                {hiddenAt}
                {row.hidden_reason ? ` · ${row.hidden_reason}` : ""}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}
