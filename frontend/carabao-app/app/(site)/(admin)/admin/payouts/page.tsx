"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ADMIN_PAGE_SIZE,
  fetchAdminPayoutBatchesPage,
  fetchWalletBalance,
  refreshPayoutBatch,
  releasePayoutBatch,
  type AdminPayoutFilter,
  type AdminPayoutSort,
  type AdminPayoutSummary,
  type PayoutBatch,
  type WalletBalance,
} from "@/util/api/admin";
import { PAYOUT_STATUS_LABELS } from "@/util/api/statuses";
import {
  PAYOUT_PROVIDER_LABELS,
  PAYOUT_PROVIDER_TIMING,
  type PayoutType,
} from "@/util/api/merchants";
import styles from "./page.module.css";
import PageHeader from "../../PageHeader";
import SortHeader, { readSort, writeSort, type SortState } from "../../SortHeader";
import PageLoader from "@/components/PageLoader/PageLoader";
import TablePanel, { TablePage, TableSearch, TableSegments, TableSort, TableStat, type SortOption } from "../../TablePanel";

const peso = (v: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(v);

const pesoCents = (v: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 }).format(v);

const shortDate = (v: string) =>
  new Date(v).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });

const METHOD_LABELS: Record<PayoutType, string> = { gcash: "GCash", maya: "Maya", bank: "Bank" };

const STATUS_FILTERS: { key: AdminPayoutFilter | null; label: string }[] = [
  { key: null, label: "All" },
  { key: "pending", label: "Requested" },
  { key: "processing", label: "Processing" },
  { key: "released", label: "Released" },
  { key: "failed", label: "Failed" },
];
const STATUS_KEYS = STATUS_FILTERS.flatMap((f) => (f.key ? [f.key] : []));
const STATUS_OPTIONS = STATUS_FILTERS.map((f) => ({ value: (f.key ?? "") as AdminPayoutFilter | "", label: f.label }));
const SORT_OPTIONS: SortOption<AdminPayoutSort>[] = [
  { key: "requested", label: "Requested", firstOrder: "desc" },
  { key: "merchant", label: "Merchant" },
  { key: "orders", label: "Orders", firstOrder: "desc" },
  { key: "amount", label: "Amount", firstOrder: "desc" },
  { key: "status", label: "Status" },
];

const SORT_KEYS: readonly AdminPayoutSort[] = ["requested", "merchant", "orders", "amount", "status"];
/** The server's order when no sort is sent: newest request first. */
const DEFAULT_SORT: SortState<AdminPayoutSort> = { sort: "requested", order: "desc" };

const SENDABLE = new Set(["pending", "approved", "failed"]);

const apiDetail = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? fallback;

/** What the merchant receives: the stored net, or the gross minus the fee. */
const netOf = (b: PayoutBatch) => b.net_amount ?? b.gross_amount - (b.transfer_fee ?? 0);

export default function PayoutsPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading payouts…" />}>
      <PayoutsContent />
    </Suspense>
  );
}

function PayoutsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const status = STATUS_KEYS.find((k) => k === searchParams.get("status")) ?? null;
  const q = searchParams.get("q")?.trim() ?? "";
  const current = readSort<AdminPayoutSort>(searchParams, SORT_KEYS, DEFAULT_SORT);
  const { sort, order } = current;
  const key = `${status ?? ""}|${q}|${sort}|${order}|${page}`;

  const [batches, setBatches] = useState<PayoutBatch[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<AdminPayoutSummary | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  // Bumped after a send or status check so the totals and filtered rows catch up.
  const [reloads, setReloads] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<PayoutBatch | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // undefined while loading, null when PayMongo couldn't be reached.
  const [wallet, setWallet] = useState<WalletBalance | null | undefined>(undefined);

  const loadWallet = () =>
    fetchWalletBalance()
      .then(setWallet)
      .catch(() => setWallet(null));

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const replace = (updated: PayoutBatch) =>
    setBatches((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));

  useEffect(() => {
    void loadWallet();
  }, []);

  useEffect(() => {
    let stale = false;
    const filters = {
      ...(status ? { status } : {}),
      ...(q ? { q } : {}),
      ...(sort ? { sort, order } : {}),
    };
    fetchAdminPayoutBatchesPage(filters, page)
      .then((res) => {
        if (stale) return;
        setBatches(res.items);
        setTotal(res.total);
        setSummary(res.summary);
        setError(null);
      })
      .catch(() => {
        if (!stale) setError("Failed to load payout data.");
      })
      .finally(() => {
        if (!stale) setLoadedKey(`${status ?? ""}|${q}|${sort}|${order}|${page}`);
      });
    return () => {
      stale = true;
    };
  }, [status, q, sort, order, page, reloads]);

  const loading = loadedKey !== key;

  const go = (next: {
    status?: AdminPayoutFilter | null;
    q?: string;
    sort?: SortState<AdminPayoutSort>;
    page?: number;
  }) => {
    const params = new URLSearchParams();
    const nextStatus = next.status !== undefined ? next.status : status;
    const nextQ = next.q !== undefined ? next.q.trim() : q;
    const nextSort = next.sort ?? current;
    if (nextStatus) params.set("status", nextStatus);
    if (nextQ) params.set("q", nextQ);
    if (nextSort.sort !== DEFAULT_SORT.sort || nextSort.order !== DEFAULT_SORT.order) writeSort(params, nextSort);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const onSort = (next: SortState<AdminPayoutSort>) => go({ sort: next, page: 1 });

  const handleSend = async (batch: PayoutBatch) => {
    setConfirming(null);
    setBusyId(batch.id);
    try {
      const updated = await releasePayoutBatch(batch.id);
      replace(updated);
      setReloads((n) => n + 1);
      void loadWallet();
      showToast(
        updated.status === "failed"
          ? `PayMongo refused the transfer: ${updated.failure_reason ?? "unknown reason"}`
          : updated.status === "released"
            ? "Payout delivered."
            : `Sent ${peso(netOf(updated))} via ${
                updated.transfer_provider ? PAYOUT_PROVIDER_LABELS[updated.transfer_provider] : "PayMongo"
              }. It shows as released once the transfer settles.`,
      );
    } catch (e) {
      showToast(apiDetail(e, "Failed to send payout."));
    } finally {
      setBusyId(null);
    }
  };

  const handleRefresh = async (batch: PayoutBatch) => {
    setBusyId(batch.id);
    try {
      const updated = await refreshPayoutBatch(batch.id);
      replace(updated);
      setReloads((n) => n + 1);
      void loadWallet();
      showToast(`Status: ${PAYOUT_STATUS_LABELS[updated.status]}`);
    } catch (e) {
      showToast(apiDetail(e, "Could not check the status."));
    } finally {
      setBusyId(null);
    }
  };

  const firstLoad = !summary && !error;
  const waiting = summary?.waiting ?? 0;
  const owed = summary?.owed ?? 0;
  const totalReleased = summary?.released ?? 0;
  const filtering = Boolean(status || q);

  const renderAction = (batch: PayoutBatch) => {
    const busy = busyId === batch.id;
    if (SENDABLE.has(batch.status)) {
      return (
        <button className={styles.releaseBtn} disabled={busy} onClick={() => setConfirming(batch)}>
          {busy ? "Sending…" : batch.status === "failed" ? "Resend" : `Send ${peso(netOf(batch))}`}
        </button>
      );
    }
    if (batch.status === "processing") {
      return (
        <div className={styles.actionStack}>
          <button className={styles.secondaryBtn} disabled={busy} onClick={() => void handleRefresh(batch)}>
            {busy ? "Checking…" : "Check status"}
          </button>
          {batch.failure_reason && <span className={styles.rowNote}>{batch.failure_reason}</span>}
        </div>
      );
    }
    if (batch.status === "released") {
      return (
        <span className={styles.releasedNote}>
          {batch.released_at ? shortDate(batch.released_at) : "Released"}
          {batch.provider_reference && ` · Ref ${batch.provider_reference}`}
        </span>
      );
    }
    return <span className={styles.emptyCell}>—</span>;
  };

  const renderDestination = (batch: PayoutBatch) => {
    // Sent batches show where the money actually went; others, where it would go.
    if (batch.destination_type && batch.status !== "pending") {
      return (
        <>
          <p className={styles.merchantName}>{METHOD_LABELS[batch.destination_type]} · {batch.destination_number}</p>
          <p className={styles.subText}>
            {batch.destination_name}
            {batch.transfer_provider && ` · ${PAYOUT_PROVIDER_LABELS[batch.transfer_provider]}`}
          </p>
        </>
      );
    }
    const d = batch.destination;
    if (!d) return <span className={styles.rowNoteError}>No payout method</span>;
    return (
      <>
        <p className={styles.merchantName}>{d.institution ?? METHOD_LABELS[d.type]} · {d.number ?? "—"}</p>
        <p className={styles.subText}>
          {d.name ?? "—"}
          {d.provider && ` · ${PAYOUT_PROVIDER_LABELS[d.provider]}`}
        </p>
        {d.problem && <p className={styles.rowNoteError}>{d.problem}</p>}
      </>
    );
  };

  const c = confirming;
  const cDest = c?.destination;
  // The wallet pays the merchant's net plus PayMongo's fee, i.e. the gross.
  const cShort = c && wallet ? c.gross_amount > wallet.available : false;

  return (
    <TablePage>
      {toast && <div className={styles.toast}>{toast}</div>}

      <PageHeader
        eyebrow="Money"
        title="Payouts"
        count={summary ? total : undefined}
        description="Merchants request cash outs; sending one transfers it from the PayMongo wallet by InstaPay."
      />

      <TablePanel
        summary={
          summary && (
            <>
              <TableStat label="Waiting to send" value={waiting} alert={waiting > 0} />
              <TableStat label="Still owed to merchants" value={peso(owed)} alert={waiting > 0} />
              <TableStat
                label="PayMongo wallet"
                value={wallet === undefined ? "…" : wallet === null ? "—" : pesoCents(wallet.available)}
                alert={Boolean(wallet && wallet.available < owed)}
                hint={
                  wallet === null ? (
                    <>
                      Couldn&apos;t reach PayMongo.{" "}
                      <button className={styles.linkBtn} onClick={() => void loadWallet()}>
                        Retry
                      </button>
                    </>
                  ) : wallet && wallet.available < owed ? (
                    "Not enough to cover every open payout"
                  ) : (
                    "Available to send"
                  )
                }
              />
              <TableStat label="Released (all time)" value={peso(totalReleased)} />
            </>
          )
        }
        filters={
          <TableSegments
            label="Filter by status"
            options={STATUS_OPTIONS}
            value={status ?? ""}
            onChange={(v) => go({ status: v || null, page: 1 })}
          />
        }
        sort={<TableSort options={SORT_OPTIONS} current={current} onSort={onSort} defaultLabel="Newest first" />}
        search={<TableSearch applied={q} onSearch={(v) => go({ q: v, page: 1 })} placeholder="Merchant, #batch, account, ref" label="Search payouts" />}
        message={
          firstLoad ? "Loading payouts…" : (error ?? (batches.length === 0 ? (filtering ? "No payouts match this search or filter." : "No payout requests yet.") : null))
        }
        messageTone={error ? "error" : undefined}
        loading={loading}
        pagination={{ page, pageSize: ADMIN_PAGE_SIZE, total, onPageChange: (p) => go({ page: p }) }}
      >
          <table className={styles.table}>
            <thead>
              <tr>
                <SortHeader label="Requested" sortKey="requested" current={current} onSort={onSort} firstOrder="desc" />
                <SortHeader label="Merchant" sortKey="merchant" current={current} onSort={onSort} />
                <SortHeader
                  label="Orders"
                  sortKey="orders"
                  current={current}
                  onSort={onSort}
                  firstOrder="desc"
                  className={styles.numCol}
                />
                <SortHeader
                  label="Amount"
                  sortKey="amount"
                  current={current}
                  onSort={onSort}
                  firstOrder="desc"
                  className={styles.numCol}
                />
                <th>Send To</th>
                <SortHeader label="Status" sortKey="status" current={current} onSort={onSort} />
                <th className={styles.actionCol}>Action</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                  <tr key={batch.id}>
                    <td className={styles.nowrap}>{shortDate(batch.created_at)}</td>
                    <td>
                      <p className={styles.merchantName}>{batch.merchant_name ?? "—"}</p>
                      <p className={styles.merchantId}>ID {batch.merchant_id} · #{batch.id}</p>
                    </td>
                    <td className={styles.numCol}>{batch.transaction_count}</td>
                    <td className={styles.numCol}>
                      <p className={styles.amount}>{peso(netOf(batch))}</p>
                      <p className={styles.subText}>
                        {peso(batch.gross_amount)} − {peso(batch.transfer_fee ?? 0)} fee
                      </p>
                    </td>
                    <td>{renderDestination(batch)}</td>
                    <td>
                      <span className={`${styles.badge} ${styles[`badge_${batch.status}`]}`}>
                        {PAYOUT_STATUS_LABELS[batch.status]}
                      </span>
                      {batch.status === "failed" && batch.failure_reason && (
                        <p className={styles.rowNoteError}>{batch.failure_reason}</p>
                      )}
                    </td>
                    <td className={styles.actionCol}>{renderAction(batch)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
      </TablePanel>

      {c && (
        <div className={styles.modalBackdrop} onClick={() => setConfirming(null)}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="send-payout-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="send-payout-title" className={styles.modalTitle}>
              {c.status === "failed" ? "Resend" : "Send"} {peso(netOf(c))} to {c.merchant_name ?? `merchant ${c.merchant_id}`}?
            </h2>
            <dl className={styles.modalList}>
              <dt>Method</dt>
              <dd>{cDest ? cDest.institution ?? METHOD_LABELS[cDest.type] : "—"}</dd>
              <dt>Account name</dt>
              <dd>{cDest?.name ?? "—"}</dd>
              <dt>{cDest?.type === "bank" ? "Account number" : "Mobile number"}</dt>
              <dd className={styles.mono}>{cDest?.number ?? "—"}</dd>
              <dt>Network</dt>
              <dd>{cDest?.provider ? PAYOUT_PROVIDER_LABELS[cDest.provider] : "—"}</dd>
              <dt>Earned</dt>
              <dd>{peso(c.gross_amount)} from {c.transaction_count} order{c.transaction_count === 1 ? "" : "s"}</dd>
              <dt>Transfer fee</dt>
              <dd>− {peso(c.gross_amount - netOf(c))}</dd>
              <dt>Merchant receives</dt>
              <dd className={styles.modalTotal}>{peso(netOf(c))}</dd>
            </dl>
            {cShort && wallet && (
              <p className={styles.rowNoteError}>
                The wallet has {pesoCents(wallet.available)}, less than the {peso(c.gross_amount)} this payout takes
                (amount plus fee). PayMongo will reject it until buyer payments settle into the wallet.
              </p>
            )}
            {c.status === "failed" && c.failure_reason && (
              <p className={styles.rowNoteError}>Last attempt failed: {c.failure_reason}</p>
            )}
            {cDest?.problem ? (
              <p className={styles.rowNoteError}>Can&apos;t send yet: {cDest.problem} Ask the merchant to update it.</p>
            ) : (
              <p className={styles.modalWarning}>
                Money leaves the PayMongo wallet immediately and can&apos;t be reversed. Check the account details.
                {cDest?.provider && ` It ${PAYOUT_PROVIDER_TIMING[cDest.provider]}.`}
              </p>
            )}
            <div className={styles.modalActions}>
              <button className={styles.secondaryBtn} onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button
                className={styles.releaseBtn}
                disabled={!cDest || Boolean(cDest.problem)}
                onClick={() => void handleSend(c)}
              >
                Send {peso(netOf(c))}
              </button>
            </div>
          </div>
        </div>
      )}
    </TablePage>
  );
}
