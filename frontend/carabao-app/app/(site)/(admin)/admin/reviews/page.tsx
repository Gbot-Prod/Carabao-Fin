"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ADMIN_PAGE_SIZE,
  fetchAdminReviews,
  hideReview,
  unhideReview,
  type AdminReview,
  type AdminReviewSort,
} from "@/util/api/admin";
import getApiErrorMessage from "@/util/errorHelper";
import PageLoader from "@/components/PageLoader/PageLoader";
import styles from "../orders/page.module.css";
import suspend from "../../suspend.module.css";
import PageHeader from "../../PageHeader";
import SortHeader, { readSort, writeSort, type SortState } from "../../SortHeader";
import TablePanel, { TablePage, TableFilter, TableSearch, TableSort, type SortOption } from "../../TablePanel";

const SORT_KEYS = ["date", "farm", "rating"] as const;
const SORT_OPTIONS: SortOption<AdminReviewSort>[] = [
  { key: "date", label: "Date", firstOrder: "desc" },
  { key: "farm", label: "Farm" },
  { key: "rating", label: "Rating" },
];
// The server's own order: newest first.
const DEFAULT_SORT: SortState<AdminReviewSort> = { sort: "date", order: "desc" };

type Visibility = "" | "visible" | "hidden";
type Stars = "" | "1" | "2" | "3";

/** CF-0075 (B22): find abusive or fake reviews and hide them (or restore). */
export default function AdminReviewsPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading reviews…" />}>
      <ReviewsContent />
    </Suspense>
  );
}

function ReviewsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const visibility = (searchParams.get("show") as Visibility) || "";
  const stars = (searchParams.get("stars") as Stars) || "";
  const q = searchParams.get("q") || "";
  const { sort, order } = readSort<AdminReviewSort>(searchParams, SORT_KEYS, DEFAULT_SORT);
  const current: SortState<AdminReviewSort> = { sort, order };
  const key = `${visibility}|${stars}|${q}|${sort}|${order}|${page}`;

  const [rows, setRows] = useState<AdminReview[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);

  useEffect(() => {
    const hidden = visibility === "hidden" ? true : visibility === "visible" ? false : undefined;
    fetchAdminReviews(
      { hidden, max_rating: stars ? Number(stars) : undefined, q: q || undefined, sort: sort ?? undefined, order },
      page,
    )
      .then((res) => {
        setRows(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch(() => setError("Failed to load reviews."))
      .finally(() => setLoadedKey(`${visibility}|${stars}|${q}|${sort}|${order}|${page}`));
  }, [visibility, stars, q, sort, order, page]);

  const loading = loadedKey !== key;

  const go = (next: { show?: Visibility; stars?: Stars; q?: string; sort?: SortState<AdminReviewSort>; page?: number }) => {
    const params = new URLSearchParams();
    const show = next.show ?? visibility;
    const maxStars = next.stars ?? stars;
    const query = next.q ?? q;
    if (show) params.set("show", show);
    if (maxStars) params.set("stars", maxStars);
    if (query) params.set("q", query);
    const nextSort = next.sort ?? current;
    if (nextSort.sort !== DEFAULT_SORT.sort || nextSort.order !== DEFAULT_SORT.order) writeSort(params, nextSort);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };
  const onSort = (next: SortState<AdminReviewSort>) => go({ sort: next, page: 1 });

  const replace = (updated: AdminReview) =>
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));

  const hide = async (row: AdminReview) => {
    const reason = window.prompt(
      `Hide this ${row.rating}-star review of ${row.merchant_name ?? "the farm"}? It leaves the farm page and the farm's rating.\n\nReason:`,
    );
    if (reason === null) return;
    if (!reason.trim()) {
      setRowError({ id: row.id, message: "A reason is required." });
      return;
    }
    setBusy(row.id);
    setRowError(null);
    try {
      replace(await hideReview(row.id, reason.trim()));
    } catch (err) {
      setRowError({ id: row.id, message: getApiErrorMessage(err) ?? "Could not hide the review." });
    } finally {
      setBusy(null);
    }
  };

  const restore = async (row: AdminReview) => {
    if (!window.confirm("Show this review on the farm page again? It counts in the rating again.")) return;
    setBusy(row.id);
    setRowError(null);
    try {
      replace(await unhideReview(row.id));
    } catch (err) {
      setRowError({ id: row.id, message: getApiErrorMessage(err) ?? "Could not restore the review." });
    } finally {
      setBusy(null);
    }
  };

  const firstLoad = loading && rows.length === 0 && !error;

  return (
    <TablePage>
      <PageHeader
        eyebrow="People"
        title="Reviews"
        count={total}
        description="What buyers wrote about farms. Hide abuse, spam or fake reviews; a hidden review leaves the farm page and its rating."
      />

      <TablePanel
        activeFilters={[visibility, stars].filter(Boolean).length}
        filters={
          <>
            <TableFilter label="Show" value={visibility} onChange={(v) => go({ show: v as Visibility, page: 1 })}>
              <option value="">All reviews</option>
              <option value="visible">Shown to buyers</option>
              <option value="hidden">Hidden by admin</option>
            </TableFilter>
            <TableFilter label="Rating" value={stars} onChange={(v) => go({ stars: v as Stars, page: 1 })}>
              <option value="">Any</option>
              <option value="1">1 star</option>
              <option value="2">2 stars or less</option>
              <option value="3">3 stars or less</option>
            </TableFilter>
          </>
        }
        sort={<TableSort options={SORT_OPTIONS} current={current} onSort={onSort} defaultLabel="Newest first" />}
        search={<TableSearch applied={q} onSearch={(v) => go({ q: v, page: 1 })} placeholder="Search comments, e.g. fake" label="Search review comments" />}
        message={firstLoad ? "Loading reviews…" : error ?? (rows.length === 0 ? "No reviews match." : null)}
        messageTone={error ? "error" : undefined}
        loading={loading}
        pagination={{ page, pageSize: ADMIN_PAGE_SIZE, total, onPageChange: (p) => go({ page: p }) }}
      >
          <table>
            <thead>
              <tr>
                <SortHeader label="Date" sortKey="date" current={current} onSort={onSort} firstOrder="desc" />
                <SortHeader label="Farm" sortKey="farm" current={current} onSort={onSort} />
                <SortHeader label="Rating" sortKey="rating" current={current} onSort={onSort} />
                <th>Review</th>
                <th>By</th>
                <th>Moderation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className={styles.mono}>{new Date(row.created_at).toLocaleDateString("en-PH")}</td>
                  <td>{row.merchant_name ?? "—"}</td>
                  <td className={styles.mono} aria-label={`${row.rating} of 5 stars`}>
                    {"★".repeat(row.rating)}
                    {"☆".repeat(5 - row.rating)}
                  </td>
                  <td>
                    {row.comment ?? <span className={styles.sub}>(no comment)</span>}
                    {row.merchant_reply && <div className={styles.sub}>Farm reply: {row.merchant_reply}</div>}
                    {row.order_id && <div className={styles.sub}>Order #{row.order_id}</div>}
                  </td>
                  <td>{row.reviewer_name}</td>
                  <td>
                    <div className={suspend.wrap}>
                      {row.hidden_at ? (
                        <>
                          <span className={suspend.suspended}>Hidden</span>
                          <button
                            type="button"
                            className={suspend.action}
                            disabled={busy === row.id}
                            onClick={() => void restore(row)}
                          >
                            Restore
                          </button>
                          {row.hidden_reason && <span className={suspend.reason}>{row.hidden_reason}</span>}
                        </>
                      ) : (
                        <>
                          <span className={suspend.active}>Shown</span>
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
                      {rowError?.id === row.id && (
                        <span className={suspend.error} role="alert">
                          {rowError.message}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
      </TablePanel>
    </TablePage>
  );
}
