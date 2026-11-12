"use client";

import { useEffect, useState } from "react";
import {
  fetchAdminPayoutBatches,
  fetchWalletBalance,
  refreshPayoutBatch,
  releasePayoutBatch,
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
import PageLoader from "@/components/PageLoader/PageLoader";

const peso = (v: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(v);

const pesoCents = (v: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 }).format(v);

const shortDate = (v: string) =>
  new Date(v).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });

const METHOD_LABELS: Record<PayoutType, string> = { gcash: "GCash", maya: "Maya", bank: "Bank" };

type Filter = "all" | "pending" | "processing" | "released" | "failed";

const STATUS_FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Requested" },
  { key: "processing", label: "Processing" },
  { key: "released", label: "Released" },
  { key: "failed", label: "Failed" },
];

const SENDABLE = new Set(["pending", "approved", "failed"]);

const apiDetail = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? fallback;

/** What the merchant receives: the stored net, or the gross minus the fee. */
const netOf = (b: PayoutBatch) => b.net_amount ?? b.gross_amount - (b.transfer_fee ?? 0);

export default function PayoutsPage() {
  const [batches, setBatches] = useState<PayoutBatch[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
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
    fetchAdminPayoutBatches()
      .then(setBatches)
      .catch(() => setError("Failed to load payout data."))
      .finally(() => setLoading(false));
    void loadWallet();
  }, []);

  const handleSend = async (batch: PayoutBatch) => {
    setConfirming(null);
    setBusyId(batch.id);
    try {
      const updated = await releasePayoutBatch(batch.id);
      replace(updated);
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
      void loadWallet();
      showToast(`Status: ${PAYOUT_STATUS_LABELS[updated.status]}`);
    } catch (e) {
      showToast(apiDetail(e, "Could not check the status."));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <PageLoader label="Loading payouts…" />;
  if (error) return <div className={styles.stateError}>{error}</div>;

  const filtered =
    filter === "all"
      ? batches
      : batches.filter((b) => (filter === "pending" ? b.status === "pending" || b.status === "approved" : b.status === filter));
  const needsAction = batches.filter((b) => SENDABLE.has(b.status));
  const owed = batches.filter((b) => b.status !== "released").reduce((sum, b) => sum + netOf(b), 0);
  const totalReleased = batches.filter((b) => b.status === "released").reduce((sum, b) => sum + netOf(b), 0);

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
          <p className={styles.merchantId}>
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
        <p className={styles.merchantId}>
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
    <div className={styles.page}>
      {toast && <div className={styles.toast}>{toast}</div>}

      <div className={styles.header}>
        <div>
          <h1 className={styles.heading}>Payouts</h1>
          <p className={styles.subheading}>
            Merchants request cash outs; sending one transfers it from the PayMongo wallet (InstaPay, or PESONet
            for GCash).
          </p>
        </div>
      </div>

      <div className={styles.kpiRow}>
        <div className={`${styles.kpiCard} ${needsAction.length > 0 ? styles.kpiCardAlert : ""}`}>
          <p className={styles.kpiLabel}>Waiting to Send</p>
          <p className={styles.kpiValue}>{needsAction.length}</p>
        </div>
        <div className={`${styles.kpiCard} ${needsAction.length > 0 ? styles.kpiCardAlert : ""}`}>
          <p className={styles.kpiLabel}>Still Owed to Merchants</p>
          <p className={styles.kpiValue}>{peso(owed)}</p>
        </div>
        <div className={`${styles.kpiCard} ${wallet && wallet.available < owed ? styles.kpiCardAlert : ""}`}>
          <p className={styles.kpiLabel}>PayMongo Wallet</p>
          <p className={styles.kpiValue}>
            {wallet === undefined ? "…" : wallet === null ? "—" : pesoCents(wallet.available)}
          </p>
          <p className={styles.kpiHint}>
            {wallet === null ? (
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
            )}
          </p>
        </div>
        <div className={styles.kpiCard}>
          <p className={styles.kpiLabel}>Total Released (All Time)</p>
          <p className={styles.kpiValue}>{peso(totalReleased)}</p>
        </div>
      </div>

      <div className={styles.tableCard}>
        <div className={styles.tableHeader}>
          <p className={styles.tableTitle}>
            Payout Requests
            {needsAction.length > 0 && <span className={styles.alertBadge}>{needsAction.length} need action</span>}
          </p>
          <div className={styles.filterRow}>
            {STATUS_FILTERS.map(({ key, label }) => (
              <button
                key={key}
                className={`${styles.filterBtn} ${filter === key ? styles.filterBtnActive : ""}`}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <table className={styles.table}>
          <thead>
            <tr>
              <th>Requested</th>
              <th>Merchant</th>
              <th>Orders</th>
              <th>Amount</th>
              <th>Send To</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr className={styles.emptyRow}>
                <td colSpan={7}>No payouts found.</td>
              </tr>
            ) : (
              filtered.map((batch) => (
                <tr key={batch.id}>
                  <td>{shortDate(batch.created_at)}</td>
                  <td>
                    <p className={styles.merchantName}>{batch.merchant_name ?? "—"}</p>
                    <p className={styles.merchantId}>ID {batch.merchant_id} · #{batch.id}</p>
                  </td>
                  <td>{batch.transaction_count}</td>
                  <td>
                    <p className={styles.amount}>{peso(netOf(batch))}</p>
                    <p className={styles.merchantId}>
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
                  <td>{renderAction(batch)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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
    </div>
  );
}
