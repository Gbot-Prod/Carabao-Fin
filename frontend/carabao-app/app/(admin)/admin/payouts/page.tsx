"use client";

import { useEffect, useState } from "react";
import {
  fetchAdminPayoutBatches,
  fetchAdminMerchants,
  generatePayoutBatches,
  releasePayoutBatch,
  type PayoutBatch,
  type Merchant,
} from "@/util/api/admin";
import styles from "./page.module.css";

const peso = (v: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(v);

type Filter = "all" | "pending" | "released" | "failed";

const STATUS_FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "released", label: "Released" },
  { key: "failed", label: "Failed" },
];

export default function PayoutsPage() {
  const [batches, setBatches] = useState<PayoutBatch[]>([]);
  const [merchants, setMerchants] = useState<Record<number, string>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [releasingId, setReleasingId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = async () => {
    try {
      const [b, m] = await Promise.all([
        fetchAdminPayoutBatches(),
        fetchAdminMerchants(),
      ]);
      setBatches(b);
      setMerchants(Object.fromEntries(m.map((mer: Merchant) => [mer.id, mer.merchant_name])));
    } catch {
      setError("Failed to load payout data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const created = await generatePayoutBatches();
      if (created.length === 0) {
        showToast("No new paid orders to batch for today.");
      } else {
        showToast(`Generated ${created.length} batch${created.length > 1 ? "es" : ""} for today.`);
        await load();
      }
    } catch {
      showToast("Failed to generate batches.");
    } finally {
      setGenerating(false);
    }
  };

  const handleRelease = async (batchId: number) => {
    setReleasingId(batchId);
    try {
      const updated = await releasePayoutBatch(batchId, notes[batchId]);
      setBatches((prev) => prev.map((b) => (b.id === batchId ? updated : b)));
      showToast("Batch marked as released.");
    } catch {
      showToast("Failed to release batch.");
    } finally {
      setReleasingId(null);
    }
  };

  if (loading) return <div className={styles.state}>Loading payouts…</div>;
  if (error) return <div className={styles.stateError}>{error}</div>;

  const filtered = filter === "all" ? batches : batches.filter((b) => b.status === filter);
  const pending = batches.filter((b) => b.status === "pending");
  const totalOwed = pending.reduce((sum, b) => sum + b.gross_amount, 0);
  const totalReleased = batches
    .filter((b) => b.status === "released")
    .reduce((sum, b) => sum + b.gross_amount, 0);

  return (
    <div className={styles.page}>
      {toast && <div className={styles.toast}>{toast}</div>}

      <div className={styles.header}>
        <div>
          <h1 className={styles.heading}>Payouts</h1>
          <p className={styles.subheading}>Track and release merchant settlements</p>
        </div>
        <button
          className={styles.generateBtn}
          onClick={() => void handleGenerate()}
          disabled={generating}
        >
          {generating ? "Generating…" : "Generate Today's Batches"}
        </button>
      </div>

      <div className={styles.infoBanner}>
        <strong>How payouts work:</strong> When a user pays, the full amount lands in Carabao's PayMongo wallet.
        Each merchant is owed <strong>99%</strong> of their sales — Carabao keeps the 1% platform fee.
        Generate daily batches to see what's owed per merchant, then release and transfer to their bank or e-wallet.
      </div>

      <div className={styles.kpiRow}>
        <div className={`${styles.kpiCard} ${pending.length > 0 ? styles.kpiCardAlert : ""}`}>
          <p className={styles.kpiLabel}>Pending Batches</p>
          <p className={styles.kpiValue}>{pending.length}</p>
        </div>
        <div className={`${styles.kpiCard} ${pending.length > 0 ? styles.kpiCardAlert : ""}`}>
          <p className={styles.kpiLabel}>Total Owed to Merchants</p>
          <p className={styles.kpiValue}>{peso(totalOwed)}</p>
        </div>
        <div className={styles.kpiCard}>
          <p className={styles.kpiLabel}>Total Released (All Time)</p>
          <p className={styles.kpiValue}>{peso(totalReleased)}</p>
        </div>
      </div>

      <div className={styles.tableCard}>
        <div className={styles.tableHeader}>
          <p className={styles.tableTitle}>
            Payout Batches
            {pending.length > 0 && (
              <span className={styles.alertBadge}>{pending.length} need action</span>
            )}
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

        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Merchant</th>
              <th>Orders</th>
              <th>Owed to Merchant</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr className={styles.emptyRow}>
                <td colSpan={6}>No batches found.</td>
              </tr>
            ) : (
              filtered
                .sort((a, b) => new Date(b.period_date).getTime() - new Date(a.period_date).getTime())
                .map((batch) => (
                  <tr key={batch.id}>
                    <td>{new Date(batch.period_date).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</td>
                    <td>
                      <p className={styles.merchantName}>{merchants[batch.merchant_id] ?? "—"}</p>
                      <p className={styles.merchantId}>ID {batch.merchant_id}</p>
                    </td>
                    <td>{batch.transaction_count}</td>
                    <td className={styles.amount}>{peso(batch.gross_amount)}</td>
                    <td>
                      <span className={`${styles.badge} ${styles[`badge_${batch.status}`]}`}>
                        {batch.status}
                      </span>
                    </td>
                    <td>
                      {batch.status === "pending" ? (
                        <div className={styles.actionCell}>
                          <input
                            className={styles.notesInput}
                            placeholder="Transfer ref / note"
                            value={notes[batch.id] ?? ""}
                            onChange={(e) =>
                              setNotes((prev) => ({ ...prev, [batch.id]: e.target.value }))
                            }
                          />
                          <button
                            className={styles.releaseBtn}
                            disabled={releasingId === batch.id}
                            onClick={() => void handleRelease(batch.id)}
                          >
                            {releasingId === batch.id ? "Releasing…" : "Mark Released"}
                          </button>
                        </div>
                      ) : batch.status === "released" ? (
                        <span style={{ fontSize: 12, color: "#647067" }}>
                          {batch.released_at
                            ? new Date(batch.released_at).toLocaleDateString("en-PH", { month: "short", day: "numeric" })
                            : "Released"}
                          {batch.notes && ` · ${batch.notes}`}
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: "#9ca3af" }}>—</span>
                      )}
                    </td>
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
