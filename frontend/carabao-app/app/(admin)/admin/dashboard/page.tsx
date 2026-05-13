"use client";

import { useEffect, useState } from "react";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import {
  fetchAdminStats,
  fetchAdminPayoutBatches,
  type AdminStats,
  type PayoutBatch,
} from "@/util/api/admin";
import styles from "./page.module.css";

const peso = (v: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(v);

const shortDate = (d: string) =>
  new Date(d).toLocaleDateString("en-PH", { month: "short", day: "numeric" });

const PAYOUT_STATUS_ORDER = ["pending", "approved", "processing", "released", "failed"];

function KpiCard({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className={`${styles.kpiCard} ${alert ? styles.kpiCardAlert : ""}`}>
      <p className={styles.kpiLabel}>{label}</p>
      <p className={styles.kpiValue}>{value}</p>
    </div>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [batches, setBatches] = useState<PayoutBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchAdminStats(), fetchAdminPayoutBatches()])
      .then(([s, b]) => { setStats(s); setBatches(b); })
      .catch(() => setError("Failed to load dashboard data."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className={styles.state}>Loading dashboard…</div>;
  if (error || !stats) return <div className={styles.stateError}>{error ?? "Unknown error"}</div>;

  const pendingBatchCount = batches.filter((b) => b.status === "pending").length;
  const sortedPayoutSummary = [...stats.payout_summary].sort(
    (a, b) => PAYOUT_STATUS_ORDER.indexOf(a.status) - PAYOUT_STATUS_ORDER.indexOf(b.status),
  );

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Dashboard</h1>

      {/* KPI cards */}
      <div className={styles.kpiGrid}>
        <KpiCard label="Total Revenue" value={peso(stats.total_revenue)} />
        <KpiCard label="Platform Fees" value={peso(stats.platform_fees)} />
        <KpiCard label="Total Orders" value={stats.total_orders.toLocaleString()} />
        <KpiCard label="Total Users" value={stats.total_users.toLocaleString()} />
        <KpiCard label="Active Merchants" value={stats.active_merchants.toLocaleString()} />
        <KpiCard
          label="Pending Applications"
          value={stats.pending_applications.toLocaleString()}
          alert={stats.pending_applications > 0}
        />
      </div>

      {/* Revenue chart */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Revenue — Last 30 Days</h2>
        {stats.daily_revenue.length === 0 ? (
          <p className={styles.emptyText}>No transactions in the last 30 days.</p>
        ) : (
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={stats.daily_revenue} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#31925d" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#31925d" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gFee" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#173d25" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#173d25" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0ece5" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={shortDate}
                  tick={{ fontSize: 11, fill: "#647067" }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 11, fill: "#647067" }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <Tooltip
                  formatter={(v) => peso(Number(v ?? 0))}
                  labelFormatter={shortDate}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e0ece5" }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="revenue" name="GMV" stroke="#31925d" fill="url(#gRevenue)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="platform_fee" name="Platform Fee" stroke="#173d25" fill="url(#gFee)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Order status + Payout summary */}
      <div className={styles.row}>
        <section className={`${styles.section} ${styles.flex1}`}>
          <h2 className={styles.sectionTitle}>Orders by Status</h2>
          {stats.order_breakdown.length === 0 ? (
            <p className={styles.emptyText}>No orders yet.</p>
          ) : (
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height={Math.max(160, stats.order_breakdown.length * 36)}>
                <BarChart
                  data={stats.order_breakdown}
                  layout="vertical"
                  barSize={14}
                  margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0ece5" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "#647067" }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="status" tick={{ fontSize: 11, fill: "#647067" }} tickLine={false} axisLine={false} width={88} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e0ece5" }} />
                  <Bar dataKey="count" name="Orders" fill="#31925d" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className={`${styles.section} ${styles.flex1}`}>
          <h2 className={styles.sectionTitle}>
            Payout Batches
            {pendingBatchCount > 0 && (
              <span className={styles.alertBadge}>{pendingBatchCount} pending</span>
            )}
          </h2>
          {sortedPayoutSummary.length === 0 ? (
            <p className={styles.emptyText}>No payout batches yet.</p>
          ) : (
            <div className={styles.payoutList}>
              {sortedPayoutSummary.map((p) => (
                <div key={p.status} className={styles.payoutRow}>
                  <div className={styles.payoutLeft}>
                    <span className={`${styles.payoutDot} ${styles[`dot_${p.status}`]}`} />
                    <span className={styles.payoutStatus}>{p.status}</span>
                    <span className={styles.payoutCount}>{p.count}</span>
                  </div>
                  <span className={styles.payoutAmount}>{peso(p.total_amount)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
