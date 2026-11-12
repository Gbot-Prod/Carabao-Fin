import { useEffect, useMemo, useState } from "react";
import styles from "../page.module.css";
import PageLoader from "@/components/PageLoader/PageLoader";
import {
  fetchMyPayoutInfo,
  fetchMyPayouts,
  fetchMyTransactions,
  PAYOUT_STATUS_LABELS,
  TRANSACTION_STATUS_LABELS,
  type MerchantPayoutBatch,
  type MerchantTransaction,
  type PayoutInfo,
} from "@/util/api";
import { formatDate, formatPeso, type StatusMessage } from "../lib/format";
import CashOutPanel from "./CashOutPanel";

export default function EarningsTab() {
  const [loaded, setLoaded] = useState(false);
  const [payoutInfo, setPayoutInfo] = useState<PayoutInfo | null>(null);
  const [payouts, setPayouts] = useState<MerchantPayoutBatch[]>([]);
  const [transactions, setTransactions] = useState<MerchantTransaction[]>([]);
  const [message, setMessage] = useState<StatusMessage | null>(null);

  useEffect(() => {
    const load = async () => {
      const [piRes, pbRes, txRes] = await Promise.allSettled([
        fetchMyPayoutInfo(),
        fetchMyPayouts(),
        fetchMyTransactions(),
      ]);
      if (piRes.status === "fulfilled") setPayoutInfo(piRes.value);
      if (pbRes.status === "fulfilled") setPayouts(pbRes.value);
      if (txRes.status === "fulfilled") setTransactions(txRes.value);
      setLoaded(true);
    };
    void load();
  }, []);

  const analytics = useMemo(() => {
    const paid = transactions.filter((t) => t.status === "paid");
    const totalPaid = paid.reduce((acc, t) => acc + t.merchant_amount, 0);
    // Only orders the buyer confirmed (or that auto-confirmed) can be cashed out.
    const totalDelivered = paid
      .filter((t) => t.order_status === "delivered")
      .reduce((acc, t) => acc + t.merchant_amount, 0);
    const totalReleased = payouts.filter((p) => p.status === "released").reduce((acc, p) => acc + p.gross_amount, 0);
    const available = Math.max(0, totalDelivered - totalReleased);
    const pendingBatch = payouts.find((p) => ["pending", "approved", "processing"].includes(p.status)) ?? null;
    return { paidCount: paid.length, totalPaid, totalReleased, available, pendingBatch };
  }, [transactions, payouts]);

  if (!loaded) return <PageLoader variant="inline" label="Loading earnings…" />;

  return (
    <div className={styles.earningsLayout}>
      <section className={styles.earningsGrid}>
        <div className={`${styles.kpiCard} ${styles.kpiCardAccent}`}>
          <span className={styles.kpiLabel}>Total Earned</span>
          <strong className={styles.kpiValue}>{formatPeso(analytics.totalPaid)}</strong>
          <span className={styles.kpiSub}>from {analytics.paidCount} paid transactions</span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Total Paid Out</span>
          <strong className={styles.kpiValue}>{formatPeso(analytics.totalReleased)}</strong>
          <span className={styles.kpiSub}>released payouts</span>
        </div>
        <div className={`${styles.kpiCard} ${styles.kpiCardGreen}`}>
          <span className={styles.kpiLabel}>Available to Cash Out</span>
          <strong className={styles.kpiValue}>{formatPeso(analytics.available)}</strong>
          <span className={styles.kpiSub}>buyer-confirmed orders, net of released payouts</span>
        </div>
      </section>

      {message && (
        <div className={`${styles.payoutMessage} ${message.type === "success" ? styles.payoutMessageSuccess : styles.payoutMessageError}`}>
          {message.text}
        </div>
      )}

      <div className={styles.earningsRow}>
        <CashOutPanel
          payoutInfo={payoutInfo}
          onPayoutInfoSaved={setPayoutInfo}
          available={analytics.available}
          pendingBatch={analytics.pendingBatch}
          onPayoutRequested={(batch) => setPayouts((prev) => [batch, ...prev])}
          onMessage={setMessage}
        />

        <div className={`${styles.panel} ${styles.grow2}`}>
          <h2 className={styles.panelTitle}>Recent Transactions</h2>
          {transactions.length === 0 ? (
            <p className={styles.emptyText}>No transactions yet.</p>
          ) : (
            <table className={styles.txTable}>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Amount</th>
                  <th>Your Share</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {transactions.slice(0, 20).map((tx) => (
                  <tr key={tx.id}>
                    <td>#{tx.order_id}</td>
                    <td>{formatPeso(tx.amount)}</td>
                    <td>{formatPeso(tx.merchant_amount)}</td>
                    <td><span className={`${styles.txBadge} ${styles[`txBadge_${tx.status}`]}`}>{TRANSACTION_STATUS_LABELS[tx.status]}</span></td>
                    <td>{formatDate(tx.paid_at ?? tx.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {payouts.length > 0 && (
        <div className={styles.panel}>
          <h2 className={styles.panelTitle}>Payout History</h2>
          <table className={styles.txTable}>
            <thead>
              <tr>
                <th>Period</th>
                <th>Transactions</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Released</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id}>
                  <td>{formatDate(p.period_date)}</td>
                  <td>{p.transaction_count}</td>
                  <td>{formatPeso(p.gross_amount)}</td>
                  <td><span className={`${styles.txBadge} ${styles[`txBadge_${p.status}`]}`}>{PAYOUT_STATUS_LABELS[p.status]}</span></td>
                  <td>{formatDate(p.released_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
