"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ADMIN_PAGE_SIZE,
  fetchPenalties,
  revokePenalty,
  type AdminPenalty,
  type PenaltySort,
} from "@/util/api/admin";
import getApiErrorMessage from "@/util/errorHelper";
import PageLoader from "@/components/PageLoader/PageLoader";
import styles from "../orders/page.module.css";
import suspend from "../../suspend.module.css";
import PageHeader from "../../PageHeader";
import TablePanel, { TablePage, TableChip, TableFilter, TableSearch, TableSort, type SortOption } from "../../TablePanel";
import SortHeader, { readSort, writeSort, type SortState } from "../../SortHeader";

const SORT_KEYS = ["date", "farm", "listing", "reason", "points"] as const;
/** The server's order when no sort is sent: newest first. */
const DEFAULT_SORT: SortState<PenaltySort> = { sort: "date", order: "desc" };
const SORT_OPTIONS: SortOption<PenaltySort>[] = [
  { key: "date", label: "Date", firstOrder: "desc" },
  { key: "farm", label: "Farm" },
  { key: "listing", label: "Listing" },
  { key: "reason", label: "Reason" },
  { key: "points", label: "Points", firstOrder: "desc" },
];

type Show = "" | "active" | "inactive";

const REVOKE_REASON_MIN = 5;

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Every penalty from a rejected listing, counting or not (backend
 * services/listing_trust.py). An admin can remove the points of one
 * rejection that still counts. The farms that have points now are on
 * /admin/penalties.
 */
export default function AdminPenaltyHistoryPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading penalty history…" />}>
      <PenaltyHistoryContent />
    </Suspense>
  );
}

function PenaltyHistoryContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const merchantId = Number(searchParams.get("merchant_id")) || undefined;
  const show = (searchParams.get("show") as Show) || "";
  const q = searchParams.get("q")?.trim() ?? "";
  const current = readSort<PenaltySort>(searchParams, SORT_KEYS, DEFAULT_SORT);
  const { sort, order } = current;
  const key = `${merchantId ?? ""}|${show}|${q}|${sort}|${order}|${page}`;

  const [rows, setRows] = useState<AdminPenalty[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<{ id: number; reason: string } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    fetchPenalties(
      {
        merchant_id: merchantId,
        active: show === "active" ? true : show === "inactive" ? false : undefined,
        q: q || undefined,
        sort: sort ?? undefined,
        order,
      },
      page,
      ADMIN_PAGE_SIZE,
    )
      .then((res) => {
        setRows(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch(() => setError("Failed to load the penalty history."))
      .finally(() => setLoadedKey(`${merchantId ?? ""}|${show}|${q}|${sort}|${order}|${page}`));
  }, [merchantId, show, q, sort, order, page, reloadTick]);

  const loading = loadedKey !== key;

  const go = (next: {
    merchant_id?: number | null;
    show?: Show;
    q?: string;
    sort?: SortState<PenaltySort>;
    page?: number;
  }) => {
    const params = new URLSearchParams();
    const m = next.merchant_id === null ? undefined : (next.merchant_id ?? merchantId);
    const s = next.show ?? show;
    const nextQ = next.q ?? q;
    const nextSort = next.sort ?? current;
    if (m) params.set("merchant_id", String(m));
    if (s) params.set("show", s);
    if (nextQ) params.set("q", nextQ);
    if (nextSort.sort !== DEFAULT_SORT.sort || nextSort.order !== DEFAULT_SORT.order) writeSort(params, nextSort);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };
  const onSort = (next: SortState<PenaltySort>) => go({ sort: next, page: 1 });

  const revoke = async (e: FormEvent) => {
    e.preventDefault();
    if (!revoking) return;
    setBusy(revoking.id);
    setRowError(null);
    try {
      await revokePenalty(revoking.id, revoking.reason);
      setRevoking(null);
      setReloadTick((n) => n + 1);
    } catch (err) {
      setRowError({ id: revoking.id, message: getApiErrorMessage(err) ?? "Could not remove the points." });
    } finally {
      setBusy(null);
    }
  };

  const firstLoad = loading && rows.length === 0 && !error;

  return (
    <TablePage>
      <PageHeader
        eyebrow="Administration"
        title="Penalty history"
        count={total}
        description="Every penalty from a rejected listing. Points count for 28 days. You can remove the points of a penalty that still counts."
      />

      <TablePanel
        activeFilters={[show, merchantId].filter(Boolean).length}
        filters={
          <>
            <TableFilter label="Show" value={show} onChange={(v) => go({ show: v as Show, page: 1 })}>
              <option value="">All penalties</option>
              <option value="active">Counting now</option>
              <option value="inactive">Expired or removed</option>
            </TableFilter>
            {merchantId && (
              <TableChip onClear={() => go({ merchant_id: null, page: 1 })} label="Show every farm">
                Farm: {rows[0]?.merchant_name ?? `#${merchantId}`}
              </TableChip>
            )}
          </>
        }
        sort={<TableSort options={SORT_OPTIONS} current={current} onSort={onSort} defaultLabel="Newest first" />}
        search={<TableSearch applied={q} onSearch={(v) => go({ q: v, page: 1 })} placeholder="Farm, listing or reason" label="Search penalties" />}
        message={firstLoad ? "Loading penalty history…" : error ?? (rows.length === 0 ? "No penalties match." : null)}
        messageTone={error ? "error" : undefined}
        loading={loading}
        pagination={{ page, pageSize: ADMIN_PAGE_SIZE, total, onPageChange: (p) => go({ page: p }) }}
      >
          <table>
            <thead>
              <tr>
                <SortHeader label="Date" sortKey="date" current={current} onSort={onSort} firstOrder="desc" />
                <SortHeader label="Farm" sortKey="farm" current={current} onSort={onSort} />
                <SortHeader label="Listing" sortKey="listing" current={current} onSort={onSort} />
                <SortHeader label="Reason" sortKey="reason" current={current} onSort={onSort} />
                <SortHeader label="Points" sortKey="points" current={current} onSort={onSort} firstOrder="desc" />
                <th>Counts until</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className={styles.mono}>{formatDate(row.created_at)}</td>
                  <td>{row.merchant_name ?? `#${row.merchant_id}`}</td>
                  <td>{row.produce_name}</td>
                  <td>{row.label}</td>
                  <td className={styles.mono}>{row.points}</td>
                  <td className={styles.mono}>{formatDate(row.expires_at)}</td>
                  <td>
                    <div className={suspend.wrap}>
                      {row.revoked_at ? (
                        <span className={suspend.suspended} title={row.revoke_reason ?? undefined}>
                          Removed {formatDate(row.revoked_at)}
                        </span>
                      ) : row.active ? (
                        <span className={suspend.review}>Counting</span>
                      ) : (
                        <span className={suspend.active}>Expired</span>
                      )}
                      {row.active && revoking?.id !== row.id && (
                        <button type="button" className={suspend.action} disabled={busy === row.id} onClick={() => setRevoking({ id: row.id, reason: "" })}>
                          Remove points
                        </button>
                      )}
                      {revoking?.id === row.id && (
                        <form className={suspend.rejectForm} onSubmit={(e) => void revoke(e)}>
                          <input
                            aria-label="Reason for the merchant"
                            placeholder="Reason (required)"
                            maxLength={500}
                            value={revoking.reason}
                            onChange={(e) => setRevoking({ ...revoking, reason: e.target.value })}
                          />
                          <button
                            type="submit"
                            className={suspend.action}
                            disabled={busy === row.id || revoking.reason.trim().length < REVOKE_REASON_MIN}
                          >
                            Remove
                          </button>
                          <button type="button" className={suspend.action} onClick={() => setRevoking(null)}>
                            Cancel
                          </button>
                        </form>
                      )}
                      {rowError?.id === row.id && <span className={suspend.error} role="alert">{rowError.message}</span>}
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
