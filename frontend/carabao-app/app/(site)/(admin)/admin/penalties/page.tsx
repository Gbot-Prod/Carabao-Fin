"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ADMIN_PAGE_SIZE,
  fetchPenalties,
  fetchPenaltyAccounts,
  revokePenalty,
  type AdminPenalty,
  type PenaltyAccount,
} from "@/util/api/admin";
import getApiErrorMessage from "@/util/errorHelper";
import Pagination from "@/components/Pagination/Pagination";
import PageLoader from "@/components/PageLoader/PageLoader";
import styles from "../orders/page.module.css";
import suspend from "../../suspend.module.css";
import PageHeader from "../../PageHeader";

type Show = "" | "active" | "inactive";

const REVOKE_REASON_MIN = 5;

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Guardrails Phase 2: penalty points from rejected listings (backend
 * services/listing_trust.py). Points count for 28 days. At 3 points a farm
 * cannot make new listings; at 6 points an admin reviews the account and
 * decides to suspend it. An admin can remove the points of one rejection.
 */
export default function AdminPenaltiesPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading penalty points…" />}>
      <PenaltiesContent />
    </Suspense>
  );
}

function PenaltiesContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const merchantId = Number(searchParams.get("merchant_id")) || undefined;
  const show = (searchParams.get("show") as Show) || "";
  const key = `${merchantId ?? ""}|${show}|${page}`;

  const [accounts, setAccounts] = useState<PenaltyAccount[]>([]);
  const [rows, setRows] = useState<AdminPenalty[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<{ id: number; reason: string } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    fetchPenaltyAccounts()
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, [reloadTick]);

  useEffect(() => {
    fetchPenalties(
      { merchant_id: merchantId, active: show === "active" ? true : show === "inactive" ? false : undefined },
      page,
      ADMIN_PAGE_SIZE,
    )
      .then((res) => {
        setRows(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch(() => setError("Failed to load the penalty points."))
      .finally(() => setLoadedKey(`${merchantId ?? ""}|${show}|${page}`));
  }, [merchantId, show, page, reloadTick]);

  const loading = loadedKey !== key;

  const go = (next: { merchant_id?: number | null; show?: Show; page?: number }) => {
    const params = new URLSearchParams();
    const m = next.merchant_id === null ? undefined : (next.merchant_id ?? merchantId);
    const s = next.show ?? show;
    if (m) params.set("merchant_id", String(m));
    if (s) params.set("show", s);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

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

  if (loading && rows.length === 0 && !error) return <PageLoader label="Loading penalty points…" />;

  const selected = merchantId ? accounts.find((a) => a.merchant_id === merchantId) : undefined;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="People"
        title="Penalty points"
        count={total}
        description="Points from rejected listings, counted for 28 days. At 3 points a farm cannot make new listings. At 6 points, review the account and decide if it must be suspended."
      />

      <h2 className={styles.sub}>Farms with points</h2>
      {accounts.length === 0 ? (
        <div className={styles.state}>No farm has active penalty points.</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Farm</th>
                <th>Points</th>
                <th>New listings</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.merchant_id} className={a.merchant_id === merchantId ? styles.rowSelected : undefined}>
                  <td>{a.merchant_name ?? `#${a.merchant_id}`}</td>
                  <td className={styles.mono}>{a.points}</td>
                  <td>{a.can_create_listings ? "Allowed" : `Blocked until ${formatDate(a.blocked_until)}`}</td>
                  <td>
                    <div className={suspend.wrap}>
                      {a.shop_suspended || a.owner_suspended ? (
                        <span className={suspend.suspended}>Suspended</span>
                      ) : a.needs_account_review ? (
                        <span className={suspend.review}>Review the account</span>
                      ) : (
                        <span className={suspend.active}>Active</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className={suspend.wrap}>
                      <button type="button" className={suspend.action} onClick={() => go({ merchant_id: a.merchant_id, page: 1 })}>
                        Show points
                      </button>
                      <Link href={`/admin/listings?merchant=${a.merchant_id}`} className={suspend.action}>
                        Listings
                      </Link>
                      {a.needs_account_review && !a.shop_suspended && (
                        <Link href="/admin/merchants" className={`${suspend.action} ${suspend.danger}`}>
                          Suspend…
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.filters}>
        <label className={styles.field}>
          <span>Show</span>
          <select value={show} onChange={(e) => go({ show: e.target.value as Show, page: 1 })}>
            <option value="">All penalties</option>
            <option value="active">Counting now</option>
            <option value="inactive">Expired or removed</option>
          </select>
        </label>
        {merchantId && (
          <button type="button" className={suspend.action} onClick={() => go({ merchant_id: null, page: 1 })}>
            Farm: {selected?.merchant_name ?? rows[0]?.merchant_name ?? `#${merchantId}`} ✕
          </button>
        )}
      </div>

      {error ? (
        <div className={styles.stateError}>{error}</div>
      ) : rows.length === 0 ? (
        <div className={styles.state}>No penalties match.</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Farm</th>
                <th>Listing</th>
                <th>Reason</th>
                <th>Points</th>
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
        </div>
      )}

      <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} total={total} disabled={loading} onPageChange={(p) => go({ page: p })} />
    </div>
  );
}
