"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { fetchPenaltyAccounts, type PenaltyAccount, type PenaltyAccountSort } from "@/util/api/admin";
import PageLoader from "@/components/PageLoader/PageLoader";
import styles from "../orders/page.module.css";
import suspend from "../../suspend.module.css";
import PageHeader from "../../PageHeader";
import TablePanel, { TablePage, TableSearch, TableSort, type SortOption } from "../../TablePanel";
import SortHeader, { readSort, writeSort, type SortState } from "../../SortHeader";

const SORT_KEYS = ["farm", "points", "listings", "state"] as const;
/** The server's order when no sort is sent: the most points first. */
const DEFAULT_SORT: SortState<PenaltyAccountSort> = { sort: "points", order: "desc" };
const SORT_OPTIONS: SortOption<PenaltyAccountSort>[] = [
  { key: "points", label: "Points", firstOrder: "desc" },
  { key: "farm", label: "Farm" },
  { key: "listings", label: "New listings" },
  { key: "state", label: "State (most urgent first)" },
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Guardrails Phase 2: the farms that have penalty points from rejected
 * listings now (backend services/listing_trust.py). Points count for 28 days.
 * At 3 points a farm cannot make new listings; at 6 points an admin reviews
 * the account and decides to suspend it. Each penalty, and removing its
 * points, is on /admin/penalty-history.
 */
export default function AdminPenaltiesPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading penalties…" />}>
      <PenaltiesContent />
    </Suspense>
  );
}

function PenaltiesContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const q = searchParams.get("q")?.trim() ?? "";
  const current = readSort<PenaltyAccountSort>(searchParams, SORT_KEYS, DEFAULT_SORT);
  const { sort, order } = current;
  const key = `${q}|${sort}|${order}`;

  const [accounts, setAccounts] = useState<PenaltyAccount[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPenaltyAccounts({ q: q || undefined, sort: sort ?? undefined, order })
      .then((res) => {
        setAccounts(res);
        setError(null);
      })
      .catch(() => setError("Failed to load the penalties."))
      .finally(() => setLoadedKey(`${q}|${sort}|${order}`));
  }, [q, sort, order]);

  const loading = loadedKey !== key;
  const firstLoad = loadedKey === null;

  const go = (next: { q?: string; sort?: SortState<PenaltyAccountSort> }) => {
    const params = new URLSearchParams();
    const nextQ = next.q ?? q;
    const nextSort = next.sort ?? current;
    if (nextQ) params.set("q", nextQ);
    if (nextSort.sort !== DEFAULT_SORT.sort || nextSort.order !== DEFAULT_SORT.order) writeSort(params, nextSort);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };
  const onSort = (next: SortState<PenaltyAccountSort>) => go({ sort: next });

  return (
    <TablePage>
      <PageHeader
        eyebrow="Administration"
        title="Penalties"
        count={firstLoad ? undefined : accounts.length}
        description="Farms with points from rejected listings, counted for 28 days. At 3 points a farm cannot make new listings. At 6 points, review the account and decide if it must be suspended."
      />

      <TablePanel
        sort={<TableSort options={SORT_OPTIONS} current={current} onSort={onSort} defaultLabel="Most points first" />}
        search={<TableSearch applied={q} onSearch={(v) => go({ q: v })} placeholder="Farm name or #id" label="Search farms" />}
        message={
          firstLoad
            ? "Loading penalties…"
            : (error ??
              (accounts.length === 0 ? (q ? "No farm matches this search." : "No farm has active penalty points.") : null))
        }
        messageTone={error ? "error" : undefined}
        loading={loading}
        count={accounts.length}
      >
          <table>
            <thead>
              <tr>
                <SortHeader label="Farm" sortKey="farm" current={current} onSort={onSort} />
                <SortHeader label="Points" sortKey="points" current={current} onSort={onSort} firstOrder="desc" />
                <SortHeader label="New listings" sortKey="listings" current={current} onSort={onSort} />
                <SortHeader label="State" sortKey="state" current={current} onSort={onSort} />
                <th />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.merchant_id}>
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
                      <Link href={`/admin/penalty-history?merchant_id=${a.merchant_id}`} className={suspend.action}>
                        History
                      </Link>
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
      </TablePanel>
    </TablePage>
  );
}
