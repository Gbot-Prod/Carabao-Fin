"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
import { ORDER_STATUS_LABELS, PAYOUT_STATUS_LABELS, type OrderStatus } from "@/util/api/statuses";
import styles from "./page.module.css";
import SkeletonList, { LoadError } from "@/components/Skeleton/Skeleton";

const peso = (v: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(v);

const shortDate = (d: unknown) =>
  new Date(String(d)).toLocaleDateString("en-PH", { month: "short", day: "numeric" });

const PAYOUT_STATUS_ORDER = ["pending", "approved", "processing", "released", "failed"];

function KpiCard({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className={`${styles.kpiCard} ${alert ? styles.kpiCardAlert : ""}`}>
      <p className={styles.kpiLabel}>{label}</p>
      <p className={styles.kpiValue}>{value}</p>
    </div>
  );
}

function PendingCard({ label, count, href, action }: { label: string; count: number; href: string; action: string }) {
  return (
    <Link href={href} className={`${styles.pendingCard} ${count > 0 ? styles.pendingCardActive : ""}`}>
      <span className={styles.pendingCount}>{count.toLocaleString()}</span>
      <span className={styles.pendingLabel}>{label}</span>
      <span className={styles.pendingAction}>{count > 0 ? action : "Nothing waiting"} →</span>
    </Link>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [batches, setBatches] = useState<PayoutBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    Promise.all([fetchAdminStats(), fetchAdminPayoutBatches()])
      .then(([s, b]) => { setStats(s); setBatches(b); setError(null); })
      .catch(() => setError("We couldn't load the dashboard. Check your connection and try again."))
      .finally(() => setLoading(false));
  }, [attempt]);

  if (loading) {
    return (
      <div className={styles.page}>
        <h1 className={styles.heading}>Dashboard</h1>
        <SkeletonList label="Loading dashboard…" rows={4} />
      </div>
    );
  }
  if (error || !stats) {
    return (
      <div className={styles.page}>
        <h1 className={styles.heading}>Dashboard</h1>
        <LoadError
          message={error ?? "We couldn't load the dashboard."}
          onRetry={() => { setLoading(true); setAttempt((n) => n + 1); }}
        />
      </div>
    );
  }

  const pendingBatchCount = batches.filter((b) => b.status === "pending").length;
  const sortedPayoutSummary = [...stats.payout_summary].sort(
    (a, b) => PAYOUT_STATUS_ORDER.indexOf(a.status) - PAYOUT_STATUS_ORDER.indexOf(b.status),
  );

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Dashboard</h1>

      {/* Work waiting on an admin */}
      <h2 className={styles.pendingTitle}>Needs your attention</h2>
      <div className={styles.pendingGrid}>
        <PendingCard
          label="Merchant applications"
          count={stats.pending_work.applications}
          href="/admin/review"
          action="Review"
        />
        <PendingCard
          label="Payouts to send"
          count={stats.pending_work.payouts_to_send}
          href="/admin/payouts"
          action="Send payouts"
        />
        <PendingCard
          label="Refunds pending"
          count={stats.pending_work.refunds_pending}
          href="/admin/refunds"
          action="Record refunds"
        />
      </div>

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

      {/* New buyers and merchants per week (A5b) */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>New Buyers and Merchants — Last 12 Weeks</h2>
        {stats.weekly_signups.every((w) => w.buyers === 0 && w.merchants === 0) ? (
          <p className={styles.emptyText}>No new buyers or merchants in the last 12 weeks.</p>
        ) : (
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={stats.weekly_signups} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0ece5" vertical={false} />
                <XAxis dataKey="week_start" tickFormatter={shortDate} tick={{ fontSize: 11, fill: "#647067" }} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#647067" }} tickLine={false} axisLine={false} width={32} />
                <Tooltip
                  labelFormatter={(d) => `Week of ${shortDate(d)}`}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e0ece5" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="buyers" name="New buyers" fill="#31925d" radius={[4, 4, 0, 0]} />
                <Bar dataKey="merchants" name="New merchants" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Top produce categories (A5c) */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Top Produce Categories — Last 30 Days</h2>
        {stats.top_categories.length === 0 ? (
          <p className={styles.emptyText}>No paid orders in the last 30 days.</p>
        ) : (
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={Math.max(160, stats.top_categories.length * 40)}>
              <BarChart
                data={stats.top_categories}
                layout="vertical"
                barSize={14}
                margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e0ece5" horizontal={false} />
                <XAxis type="number" tickFormatter={(v: number) => peso(v)} tick={{ fontSize: 11, fill: "#647067" }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="category" tick={{ fontSize: 11, fill: "#647067" }} tickLine={false} axisLine={false} width={116} />
                <Tooltip
                  formatter={(value, name, item) =>
                    name === "Item revenue"
                      ? [`${peso(Number(value))} · ${(item.payload as { quantity: number }).quantity.toLocaleString()} units`, name]
                      : [value, name]
                  }
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e0ece5" }}
                />
                <Bar dataKey="revenue" name="Item revenue" fill="#31925d" radius={[0, 4, 4, 0]} />
              </BarChart>
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
                  <YAxis type="category" dataKey="status" tickFormatter={(s: OrderStatus) => ORDER_STATUS_LABELS[s] ?? s} tick={{ fontSize: 11, fill: "#647067" }} tickLine={false} axisLine={false} width={116} />
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
                    <span className={styles.payoutStatus}>{PAYOUT_STATUS_LABELS[p.status]}</span>
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
