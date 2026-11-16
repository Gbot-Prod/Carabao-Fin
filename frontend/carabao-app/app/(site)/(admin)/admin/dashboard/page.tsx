"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import {
  ArrowDown,
  ArrowUp,
  Banknote,
  ChevronRight,
  ClipboardCheck,
  Percent,
  ShoppingBag,
  Store,
  Undo2,
  Users,
  Wallet,
} from "lucide-react";
import {
  fetchAdminStats,
  fetchAdminPayoutBatches,
  type AdminStats,
  type DailyRevenue,
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
const RANGES = [7, 14, 30] as const;
type Range = (typeof RANGES)[number];

const C = {
  green: "#277a4d",
  greenLight: "#2f9e5f",
  blue: "#2563eb",
  amber: "#d97706",
  grid: "#e6ebe7",
  tick: "#647067",
};

const tooltipStyle = { fontSize: 12, borderRadius: 8, border: "1px solid #d9e1db", boxShadow: "0 4px 12px rgba(19,46,29,.08)" };

/** YYYY-MM-DD in Manila, matching the backend's day buckets. */
const manilaDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

/** The backend only returns days with sales; fill the gaps with zeros. */
function fillDays(rows: DailyRevenue[], days = 30): DailyRevenue[] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out: DailyRevenue[] = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const date = manilaDay(new Date(now - i * 86_400_000));
    out.push(byDate.get(date) ?? { date, revenue: 0, platform_fee: 0 });
  }
  return out;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

type Tone = "green" | "blue" | "amber" | "violet" | "teal" | "red";

function Sparkline({ values, tone }: { values: number[]; tone: Tone }) {
  const max = Math.max(...values, 0);
  return (
    <div className={`${styles.spark} ${styles[`tone_${tone}`]}`} aria-hidden="true">
      {values.map((v, i) => (
        <span
          key={i}
          className={i === values.length - 1 ? styles.sparkBarLast : styles.sparkBar}
          style={{ height: `${max > 0 ? Math.max(12, (v / max) * 100) : 12}%` }}
        />
      ))}
    </div>
  );
}

function StatCard({
  icon: Icon,
  tone,
  label,
  value,
  sub,
  spark,
  progress,
  href,
  alert,
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  tone: Tone;
  label: string;
  value: string;
  sub: React.ReactNode;
  spark?: number[];
  progress?: number;
  href?: string;
  alert?: boolean;
}) {
  const body = (
    <>
      <div className={styles.statTop}>
        <span className={`${styles.statIcon} ${styles[`tone_${tone}`]}`}>
          <Icon size={18} strokeWidth={1.9} />
        </span>
        <div className={styles.statText}>
          <p className={styles.statLabel}>{label}</p>
          <p className={styles.statValue}>{value}</p>
          <p className={styles.statSub}>{sub}</p>
        </div>
        {spark && <Sparkline values={spark} tone={tone} />}
      </div>
      {progress !== undefined && (
        <div className={`${styles.progress} ${styles[`tone_${tone}`]}`} aria-hidden="true">
          <span style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </div>
      )}
    </>
  );
  const cls = `${styles.card} ${styles.statCard} ${alert ? styles.statCardAlert : ""}`;
  return href ? (
    <Link href={href} className={`${cls} ${styles.statCardLink}`}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Delta({ current, previous }: { current: number; previous: number }) {
  if (previous <= 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  const up = pct >= 0;
  return (
    <span className={`${styles.delta} ${up ? styles.deltaUp : styles.deltaDown}`}>
      {up ? <ArrowUp size={13} strokeWidth={2.5} /> : <ArrowDown size={13} strokeWidth={2.5} />}
      {Math.abs(pct)}%
    </span>
  );
}

function AttentionRow({
  icon: Icon,
  tone,
  label,
  count,
  href,
  action,
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  tone: Tone;
  label: string;
  count: number;
  href: string;
  action: string;
}) {
  return (
    <Link href={href} className={styles.attnRow}>
      <span className={`${styles.attnIcon} ${styles[`tone_${count > 0 ? tone : "green"}`]}`}>
        <Icon size={16} strokeWidth={2} />
      </span>
      <span className={styles.attnText}>
        <span className={styles.attnLabel}>{label}</span>
        <span className={styles.attnSub}>{count > 0 ? action : "Nothing waiting"}</span>
      </span>
      <span className={`${styles.attnCount} ${count > 0 ? styles.attnCountActive : ""}`}>
        {count.toLocaleString()}
      </span>
      <ChevronRight size={16} className={styles.attnChevron} />
    </Link>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [batches, setBatches] = useState<PayoutBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [range, setRange] = useState<Range>(30);

  useEffect(() => {
    Promise.all([fetchAdminStats(), fetchAdminPayoutBatches()])
      .then(([s, b]) => { setStats(s); setBatches(b); setError(null); })
      .catch(() => setError("We couldn't load the dashboard. Check your connection and try again."))
      .finally(() => setLoading(false));
  }, [attempt]);

  const days = useMemo(() => (stats ? fillDays(stats.daily_revenue) : []), [stats]);

  const header = (
    <div className={styles.header}>
      <div>
        <p className={styles.eyebrow}>Overview</p>
        <h1 className={styles.heading}>Dashboard</h1>
      </div>
      <div className={styles.headerActions}>
        <Link href="/admin/orders" className={styles.btnSecondary}>
          <ShoppingBag size={16} strokeWidth={1.9} /> View orders
        </Link>
        <Link href="/admin/payouts" className={styles.btnPrimary}>
          <Banknote size={16} strokeWidth={1.9} /> Send payouts
        </Link>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className={styles.page}>
        {header}
        <SkeletonList label="Loading dashboard…" rows={4} />
      </div>
    );
  }
  if (error || !stats) {
    return (
      <div className={styles.page}>
        {header}
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

  // Headline numbers
  const last14 = days.slice(-14);
  const gmv30 = sum(days.map((d) => d.revenue));
  const fees30 = sum(days.map((d) => d.platform_fee));
  const takeRate = stats.total_revenue > 0 ? (stats.platform_fees / stats.total_revenue) * 100 : 0;
  const delivered = stats.order_breakdown.find((o) => o.status === "delivered")?.count ?? 0;
  const deliveredPct = stats.total_orders > 0 ? (delivered / stats.total_orders) * 100 : 0;
  const weeks = stats.weekly_signups;
  const thisWeek = weeks[weeks.length - 1];
  const pendingTotal =
    stats.pending_work.applications + stats.pending_work.payouts_to_send + stats.pending_work.refunds_pending;

  // Revenue chart range + comparison with the window before it (only possible inside the 30 days we have)
  const inRange = days.slice(-range);
  const rangeGmv = sum(inRange.map((d) => d.revenue));
  const prevRange = range * 2 <= days.length ? days.slice(-range * 2, -range) : [];
  const prevGmv = sum(prevRange.map((d) => d.revenue));

  return (
    <div className={styles.page}>
      {header}

      {/* Stat cards */}
      <div className={styles.statGrid}>
        <StatCard
          icon={Wallet}
          tone="green"
          label="Total revenue"
          value={peso(stats.total_revenue)}
          sub={`${peso(gmv30)} in the last 30 days`}
          spark={last14.map((d) => d.revenue)}
        />
        <StatCard
          icon={Percent}
          tone="blue"
          label="Platform fees"
          value={peso(stats.platform_fees)}
          sub={`${takeRate.toFixed(1)}% take rate · ${peso(fees30)} this month`}
          spark={last14.map((d) => d.platform_fee)}
        />
        <StatCard
          icon={ShoppingBag}
          tone="amber"
          label="Total orders"
          value={stats.total_orders.toLocaleString()}
          sub={`${delivered.toLocaleString()} delivered (${Math.round(deliveredPct)}%)`}
          progress={deliveredPct}
        />
        <StatCard
          icon={Users}
          tone="teal"
          label="Total users"
          value={stats.total_users.toLocaleString()}
          sub={thisWeek ? `${(thisWeek.buyers + thisWeek.merchants).toLocaleString()} new this week` : "—"}
          spark={weeks.map((w) => w.buyers + w.merchants)}
        />
        <StatCard
          icon={Store}
          tone="violet"
          label="Active merchants"
          value={stats.active_merchants.toLocaleString()}
          sub={thisWeek ? `${thisWeek.merchants.toLocaleString()} joined this week` : "—"}
          spark={weeks.map((w) => w.merchants)}
        />
        <StatCard
          icon={ClipboardCheck}
          tone={stats.pending_applications > 0 ? "amber" : "green"}
          label="Pending applications"
          value={stats.pending_applications.toLocaleString()}
          sub={stats.pending_applications > 0 ? "Waiting for review →" : "All caught up"}
          href="/admin/review"
          alert={stats.pending_applications > 0}
        />
      </div>

      {/* Revenue + Needs attention */}
      <div className={styles.gridMain}>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <h2 className={styles.cardTitle}>Revenue</h2>
              <div className={styles.bigRow}>
                <span className={styles.bigValue}>{peso(rangeGmv)}</span>
                <Delta current={rangeGmv} previous={prevGmv} />
              </div>
              <p className={styles.cardSub}>
                GMV over the last {range} days{prevRange.length > 0 && prevGmv > 0 ? `, vs the ${range} days before` : ""}
              </p>
            </div>
            <div className={styles.tabs} role="tablist" aria-label="Revenue range">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="tab"
                  aria-selected={range === r}
                  className={`${styles.tab} ${range === r ? styles.tabActive : ""}`}
                  onClick={() => setRange(r)}
                >
                  {r} days
                </button>
              ))}
            </div>
          </div>
          {gmv30 === 0 ? (
            <p className={styles.emptyText}>No transactions in the last 30 days.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={inRange} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={C.greenLight} stopOpacity={0.22} />
                    <stop offset="95%" stopColor={C.greenLight} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={shortDate}
                  tick={{ fontSize: 11, fill: C.tick }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  tickFormatter={(v) => (v >= 1000 ? `₱${(v / 1000).toFixed(0)}k` : `₱${v}`)}
                  tick={{ fontSize: 11, fill: C.tick }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <Tooltip formatter={(v) => peso(Number(v ?? 0))} labelFormatter={shortDate} contentStyle={tooltipStyle} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="revenue" name="GMV" stroke={C.greenLight} fill="url(#gRevenue)" strokeWidth={2.25} dot={false} />
                <Area type="monotone" dataKey="platform_fee" name="Platform fee" stroke={C.blue} fill="none" strokeWidth={1.75} strokeDasharray="5 4" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </section>

        <section className={`${styles.card} ${styles.cardFlush}`}>
          <div className={styles.cardHeadBar}>
            <h2 className={styles.cardTitle}>Needs your attention</h2>
            {pendingTotal > 0 && <span className={styles.alertBadge}>{pendingTotal} open</span>}
          </div>
          <div className={styles.attnList}>
            <AttentionRow
              icon={ClipboardCheck}
              tone="amber"
              label="Merchant applications"
              count={stats.pending_work.applications}
              href="/admin/review"
              action="Waiting for review"
            />
            <AttentionRow
              icon={Banknote}
              tone="blue"
              label="Payouts to send"
              count={stats.pending_work.payouts_to_send}
              href="/admin/payouts"
              action="Ready to release"
            />
            <AttentionRow
              icon={Undo2}
              tone="red"
              label="Refunds pending"
              count={stats.pending_work.refunds_pending}
              href="/admin/refunds"
              action="Need to be recorded"
            />
          </div>
          {pendingTotal === 0 && <p className={styles.allClear}>You&apos;re all caught up.</p>}
        </section>
      </div>

      {/* Signups + Payout batches */}
      <div className={styles.gridMain}>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <h2 className={styles.cardTitle}>New buyers and merchants</h2>
              <p className={styles.cardSub}>Sign-ups per week, last 12 weeks</p>
            </div>
          </div>
          {weeks.every((w) => w.buyers === 0 && w.merchants === 0) ? (
            <p className={styles.emptyText}>No new buyers or merchants in the last 12 weeks.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={weeks} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                <XAxis dataKey="week_start" tickFormatter={shortDate} tick={{ fontSize: 11, fill: C.tick }} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: C.tick }} tickLine={false} axisLine={false} width={32} />
                <Tooltip labelFormatter={(d) => `Week of ${shortDate(d)}`} contentStyle={tooltipStyle} cursor={{ fill: "rgba(39,122,77,0.06)" }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="buyers" name="New buyers" fill={C.greenLight} radius={[4, 4, 0, 0]} />
                <Bar dataKey="merchants" name="New merchants" fill={C.amber} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>

        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Payout batches</h2>
            {pendingBatchCount > 0 && <span className={styles.alertBadge}>{pendingBatchCount} pending</span>}
          </div>
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
          <Link href="/admin/payouts" className={styles.cardLink}>
            Go to payouts <ChevronRight size={14} />
          </Link>
        </section>
      </div>

      {/* Categories + Orders by status */}
      <div className={styles.gridHalf}>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <h2 className={styles.cardTitle}>Top produce categories</h2>
              <p className={styles.cardSub}>Item revenue, last 30 days</p>
            </div>
          </div>
          {stats.top_categories.length === 0 ? (
            <p className={styles.emptyText}>No paid orders in the last 30 days.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, stats.top_categories.length * 40)}>
              <BarChart data={stats.top_categories} layout="vertical" barSize={14} margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} horizontal={false} />
                <XAxis type="number" tickFormatter={(v: number) => peso(v)} tick={{ fontSize: 11, fill: C.tick }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="category" tick={{ fontSize: 11, fill: C.tick }} tickLine={false} axisLine={false} width={116} />
                <Tooltip
                  formatter={(value, name, item) =>
                    name === "Item revenue"
                      ? [`${peso(Number(value))} · ${(item.payload as { quantity: number }).quantity.toLocaleString()} units`, name]
                      : [value, name]
                  }
                  contentStyle={tooltipStyle}
                  cursor={{ fill: "rgba(39,122,77,0.06)" }}
                />
                <Bar dataKey="revenue" name="Item revenue" fill={C.greenLight} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>

        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <h2 className={styles.cardTitle}>Orders by status</h2>
              <p className={styles.cardSub}>All time</p>
            </div>
          </div>
          {stats.order_breakdown.length === 0 ? (
            <p className={styles.emptyText}>No orders yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, stats.order_breakdown.length * 36)}>
              <BarChart data={stats.order_breakdown} layout="vertical" barSize={14} margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: C.tick }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="status" tickFormatter={(s: OrderStatus) => ORDER_STATUS_LABELS[s] ?? s} tick={{ fontSize: 11, fill: C.tick }} tickLine={false} axisLine={false} width={116} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(s) => ORDER_STATUS_LABELS[s as OrderStatus] ?? String(s)} cursor={{ fill: "rgba(39,122,77,0.06)" }} />
                <Bar dataKey="count" name="Orders" fill={C.green} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>
      </div>
    </div>
  );
}
