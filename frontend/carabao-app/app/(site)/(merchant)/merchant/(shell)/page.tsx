"use client";

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import getApiErrorMessage from "@/util/errorHelper";
import Link from "next/link";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Banknote,
  CalendarClock,
  ChevronRight,
  MapPin,
  Package,
  PackageX,
  Plus,
  ShoppingBag,
  Star,
  Store,
  Truck,
  Wallet,
  CirclePause,
} from "lucide-react";
import { activePause, shortDay } from "@/lib/store-pause";
import SkeletonList from "@/components/Skeleton/Skeleton";
import { merchantUrl } from "@/lib/urls";
import {
  ORDER_STATUS_LABELS,
  fetchMyAvailablePayout,
  fetchMyPayouts,
  downloadMySalesCsv,
  fetchMySales,
  fetchMyStockAlerts,
  type AvailablePayout,
  type MerchantPayoutBatch,
  type MerchantSales,
  type OrderStatus,
  type StockAlerts,
} from "@/util/api";
import { useReadyMerchant } from "../MerchantContext";
import styles from "./dashboard.module.css";

// Merchant home: the same layout as the admin dashboard (stat cards, a
// "needs your attention" list, charts), with the merchant's own numbers.

const peso = (v: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(v);

// "YYYY-MM-DD" read as a calendar date, so no timezone shifts the day.
const shortDate = (d: unknown) => {
  const [y, m, day] = String(d).split("-").map(Number);
  if (!y || !m || !day) return String(d);
  return new Date(y, m - 1, day).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
};

const orderDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" });

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

const C = { green: "#277a4d", greenLight: "#2f9e5f", amber: "#d97706", grid: "#e6ebe7", tick: "#647067" };
const tooltipStyle = { fontSize: 12, borderRadius: 8, border: "1px solid #d9e1db", boxShadow: "0 4px 12px rgba(19,46,29,.08)" };

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

type Tone = "green" | "blue" | "amber" | "violet" | "teal" | "red";
type IconType = ComponentType<{ size?: number; strokeWidth?: number }>;

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
  icon: IconType;
  tone: Tone;
  label: string;
  value: string;
  sub: ReactNode;
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

type Attention = { key: string; icon: IconType; tone: Tone; label: string; count: number; href: string; action: string };

function AttentionRow({ icon: Icon, tone, label, count, href, action }: Omit<Attention, "key">) {
  return (
    <Link href={href} className={styles.attnRow}>
      <span className={`${styles.attnIcon} ${styles[`tone_${count > 0 ? tone : "green"}`]}`}>
        <Icon size={16} strokeWidth={2} />
      </span>
      <span className={styles.attnText}>
        <span className={styles.attnLabel}>{label}</span>
        <span className={styles.attnSub}>{count > 0 ? action : "Nothing waiting"}</span>
      </span>
      <span className={`${styles.attnCount} ${count > 0 ? styles.attnCountActive : ""}`}>{count.toLocaleString()}</span>
      <ChevronRight size={16} className={styles.attnChevron} />
    </Link>
  );
}

const IN_DELIVERY: OrderStatus[] = ["shipped", "out_for_delivery"];

export default function MerchantDashboardPage() {
  const { performance, produces, ordersState, shopPage, merchant, userName, activeOrderCount, productCount } = useReadyMerchant();

  const [sales, setSales] = useState<MerchantSales | null>(null);
  const [alerts, setAlerts] = useState<StockAlerts | null>(null);
  const [available, setAvailable] = useState<AvailablePayout | null>(null);
  const [payouts, setPayouts] = useState<MerchantPayoutBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>(30);
  // CF-0055: CSV export of the selected range.
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadMySalesCsv(range);
    } catch (err) {
      setExportError(getApiErrorMessage(err, "The sales file could not be downloaded."));
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    let live = true;
    // Each card shows what loaded; one failed call does not hide the page.
    Promise.allSettled([fetchMySales(90), fetchMyStockAlerts(), fetchMyAvailablePayout(), fetchMyPayouts()]).then(
      ([s, a, av, p]) => {
        if (!live) return;
        if (s.status === "fulfilled") setSales(s.value);
        if (a.status === "fulfilled") setAlerts(a.value);
        if (av.status === "fulfilled") setAvailable(av.value);
        if (p.status === "fulfilled") setPayouts(p.value);
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const days = useMemo(() => sales?.daily ?? [], [sales]);
  const orders = ordersState.orders;

  const statusCounts = useMemo(() => {
    const c = new Map<OrderStatus, number>();
    for (const o of orders) c.set(o.status, (c.get(o.status) ?? 0) + 1);
    return [...c.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
  }, [orders]);

  const recent = useMemo(
    () => [...orders].sort((a, b) => b.ordered_at.localeCompare(a.ordered_at)).slice(0, 6),
    [orders],
  );

  const header = (
    <div className={styles.header}>
      <div>
        <p className={styles.eyebrow}>Overview</p>
        <h1 className={styles.heading}>{performance.merchant_name || "Dashboard"}</h1>
        <p className={styles.greeting}>
          {userName ? `Welcome back, ${userName.split(/\s+/)[0]}. ` : ""}This is how your shop is doing.
        </p>
      </div>
      <div className={styles.headerActions}>
        <Link href={merchantUrl("/sales")} className={styles.btnSecondary}>
          <ShoppingBag size={16} strokeWidth={1.9} /> View orders
        </Link>
        <Link href={merchantUrl("/produce")} className={styles.btnPrimary}>
          <Plus size={16} strokeWidth={1.9} /> Add produce
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

  // Sales windows (the API gives every day, oldest first, with zeros).
  const last30 = days.slice(-30);
  const prev30 = days.length >= 60 ? days.slice(-60, -30) : [];
  const last14 = days.slice(-14);
  const rev30 = sum(last30.map((d) => d.revenue));
  const revPrev30 = sum(prev30.map((d) => d.revenue));
  const orders30 = sum(last30.map((d) => d.orders));
  const ordersPrev30 = sum(prev30.map((d) => d.orders));

  const inRange = days.slice(-range);
  const rangeRevenue = sum(inRange.map((d) => d.revenue));
  const prevRange = range * 2 <= days.length ? days.slice(-range * 2, -range) : [];
  const prevRangeRevenue = sum(prevRange.map((d) => d.revenue));

  const deliveredPct = performance.total_orders > 0 ? (performance.delivered_orders / performance.total_orders) * 100 : 0;

  const readyToShip = ordersState.readyToShip.length;
  const inDelivery = orders.filter((o) => IN_DELIVERY.includes(o.status)).length;
  const outOfStock = produces.filter((p) => p.stock_quantity === 0).length;
  const lowStock = alerts?.low_stock.length ?? 0;
  const expiring = (alerts?.expiring_soon.length ?? 0) + (alerts?.expired.length ?? 0);
  // Newest first: a failure that was resent since is no longer the latest batch.
  const latestBatch = payouts[0];
  const payoutFailed = latestBatch?.status === "failed" ? 1 : 0;
  const setupMissing = (shopPage ? 0 : 1) + (merchant && (merchant.lat == null || merchant.lng == null) ? 1 : 0);
  // CF-0078 (B89): holiday mode is easy to forget once it is on.
  const pausedThrough = activePause(merchant?.paused_until);

  const attention: Attention[] = [
    { key: "ship", icon: Truck, tone: "amber", label: "Ready to ship", count: readyToShip, href: merchantUrl("/shipments"), action: "Paid orders to put on a route" },
    { key: "delivery", icon: CalendarClock, tone: "blue", label: "In delivery", count: inDelivery, href: merchantUrl("/sales"), action: "Orders on the road" },
    { key: "low", icon: Package, tone: "amber", label: "Low stock", count: lowStock, href: merchantUrl("/inventory"), action: `At or below ${alerts?.low_stock_threshold ?? 5} left` },
    { key: "out", icon: PackageX, tone: "red", label: "Out of stock", count: outOfStock, href: merchantUrl("/inventory"), action: "Buyers cannot order these" },
    { key: "expiry", icon: AlertTriangle, tone: "red", label: "Best-before soon or past", count: expiring, href: merchantUrl("/inventory"), action: "Sell or remove these first" },
    { key: "payout", icon: Banknote, tone: "red", label: "Payout failed", count: payoutFailed, href: merchantUrl("/earnings"), action: "Check your payout details" },
    { key: "paused", icon: CirclePause, tone: "amber", label: "Holiday mode", count: pausedThrough ? 1 : 0, href: merchantUrl("/settings"), action: pausedThrough ? `Orders are paused through ${shortDay(pausedThrough)}` : "Your store takes orders" },
    { key: "setup", icon: shopPage ? MapPin : Store, tone: "violet", label: "Shop setup", count: setupMissing, href: merchantUrl(shopPage ? "/settings" : "/shop"), action: shopPage ? "Set your farm pickup pin" : "Create your public shop page" },
  ];
  const openTotal = sum(attention.map((a) => a.count));

  const ratingLabel = performance.rating == null ? "—" : `${Number(performance.rating).toFixed(1)} / 5`;
  const topMax = Math.max(...(sales?.top_products.map((p) => p.revenue) ?? [0]), 0);

  return (
    <div className={styles.page}>
      {header}

      <div className={styles.statGrid}>
        <StatCard
          icon={Wallet}
          tone="green"
          label="Revenue, last 30 days"
          value={peso(rev30)}
          sub={
            <>
              {peso(performance.total_revenue)} all time <Delta current={rev30} previous={revPrev30} />
            </>
          }
          spark={last14.map((d) => d.revenue)}
        />
        <StatCard
          icon={ShoppingBag}
          tone="blue"
          label="Orders, last 30 days"
          value={orders30.toLocaleString()}
          sub={
            <>
              {performance.total_orders.toLocaleString()} all time <Delta current={orders30} previous={ordersPrev30} />
            </>
          }
          spark={last14.map((d) => d.orders)}
          href={merchantUrl("/sales")}
        />
        <StatCard
          icon={Truck}
          tone={readyToShip > 0 ? "amber" : "teal"}
          label="Active orders"
          value={activeOrderCount.toLocaleString()}
          sub={`${performance.delivered_orders.toLocaleString()} delivered (${Math.round(deliveredPct)}%)`}
          progress={deliveredPct}
          href={merchantUrl(readyToShip > 0 ? "/shipments" : "/sales")}
          alert={readyToShip > 0}
        />
        <StatCard
          icon={Banknote}
          tone="violet"
          label="Ready to cash out"
          value={available ? peso(available.net_amount) : "—"}
          sub={
            available
              ? `${available.transaction_count.toLocaleString()} paid order${available.transaction_count === 1 ? "" : "s"}, after fees`
              : "Open Earnings to see payouts"
          }
          href={merchantUrl("/earnings")}
        />
        <StatCard
          icon={Package}
          tone={outOfStock > 0 ? "red" : "teal"}
          label="Produce listed"
          value={productCount.toLocaleString()}
          sub={`${lowStock} low stock · ${outOfStock} out of stock`}
          href={merchantUrl("/inventory")}
          alert={outOfStock > 0}
        />
        <StatCard
          icon={Star}
          tone="amber"
          label="Rating"
          value={ratingLabel}
          sub={performance.rating_count ? `${performance.rating_count} review${performance.rating_count === 1 ? "" : "s"} →` : "No reviews yet"}
          href={merchantUrl("/reviews")}
        />
      </div>

      <div className={styles.gridMain}>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <h2 className={styles.cardTitle}>Revenue</h2>
              <div className={styles.bigRow}>
                <span className={styles.bigValue}>{peso(rangeRevenue)}</span>
                <Delta current={rangeRevenue} previous={prevRangeRevenue} />
              </div>
              <p className={styles.cardSub}>
                Last {range} days{prevRange.length > 0 && prevRangeRevenue > 0 ? `, against the ${range} days before` : ""}. Cancelled orders are not included.
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
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() => void exportCsv()}
              disabled={exporting}
              title={`Download the last ${range} days as a CSV file`}
            >
              {exporting ? "Preparing…" : "Export CSV"}
            </button>
          </div>
          {exportError && <p role="alert" className={styles.errorText}>{exportError}</p>}
          {!sales ? (
            <p className={styles.emptyText}>We could not load your sales. Refresh the page to try again.</p>
          ) : rangeRevenue === 0 ? (
            <p className={styles.emptyText}>No sales in the last {range} days.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={inRange} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="mRevenue" x1="0" y1="0" x2="0" y2="1">
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
                <Area type="monotone" dataKey="revenue" name="Revenue" stroke={C.greenLight} fill="url(#mRevenue)" strokeWidth={2.25} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </section>

        <section className={`${styles.card} ${styles.cardFlush}`}>
          <div className={styles.cardHeadBar}>
            <h2 className={styles.cardTitle}>Needs your attention</h2>
            {openTotal > 0 && <span className={styles.alertBadge}>{openTotal} open</span>}
          </div>
          <div className={styles.attnList}>
            {attention.map(({ key, ...row }) => (
              <AttentionRow key={key} {...row} />
            ))}
          </div>
          {openTotal === 0 && <p className={styles.allClear}>You&apos;re all caught up.</p>}
        </section>
      </div>

      <div className={styles.gridThree}>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <h2 className={styles.cardTitle}>Orders per day</h2>
              <p className={styles.cardSub}>Last {range} days</p>
            </div>
          </div>
          {!sales || sum(inRange.map((d) => d.orders)) === 0 ? (
            <p className={styles.emptyText}>No orders in the last {range} days.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={inRange} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: C.tick }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: C.tick }} tickLine={false} axisLine={false} width={28} />
                <Tooltip labelFormatter={shortDate} contentStyle={tooltipStyle} cursor={{ fill: "rgba(39,122,77,0.06)" }} />
                <Bar dataKey="orders" name="Orders" fill={C.green} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>

        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <h2 className={styles.cardTitle}>Top produce</h2>
              <p className={styles.cardSub}>By revenue, last 90 days</p>
            </div>
          </div>
          {!sales || sales.top_products.length === 0 ? (
            <p className={styles.emptyText}>No sales in the last 90 days.</p>
          ) : (
            <ol className={styles.topList}>
              {sales.top_products.map((p) => (
                <li key={`${p.produce_id ?? p.name}`} className={styles.topItem}>
                  <span className={styles.topName}>{p.name}</span>
                  <span className={styles.topValue}>{peso(p.revenue)}</span>
                  <span className={styles.topBar} aria-hidden="true">
                    <span style={{ width: `${topMax > 0 ? (p.revenue / topMax) * 100 : 0}%` }} />
                  </span>
                  <span className={styles.topSub}>{p.quantity.toLocaleString()} sold</span>
                </li>
              ))}
            </ol>
          )}
          <Link href={merchantUrl("/produce")} className={styles.cardLink}>
            Go to produce <ChevronRight size={14} />
          </Link>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <h2 className={styles.cardTitle}>Orders by status</h2>
              <p className={styles.cardSub}>All orders</p>
            </div>
          </div>
          {statusCounts.length === 0 ? (
            <p className={styles.emptyText}>No orders yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(150, statusCounts.length * 36)}>
              <BarChart data={statusCounts} layout="vertical" barSize={14} margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: C.tick }} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="status"
                  tickFormatter={(s: OrderStatus) => ORDER_STATUS_LABELS[s] ?? s}
                  tick={{ fontSize: 11, fill: C.tick }}
                  tickLine={false}
                  axisLine={false}
                  width={104}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(s) => ORDER_STATUS_LABELS[s as OrderStatus] ?? String(s)}
                  cursor={{ fill: "rgba(39,122,77,0.06)" }}
                />
                <Bar dataKey="count" name="Orders" fill={C.amber} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>
      </div>

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <div>
            <h2 className={styles.cardTitle}>Recent orders</h2>
            <p className={styles.cardSub}>The newest {recent.length} orders</p>
          </div>
        </div>
        {recent.length === 0 ? (
          <p className={styles.emptyText}>
            {ordersState.error ? ordersState.error : ordersState.loaded ? "No orders yet." : "Loading orders…"}
          </p>
        ) : (
          <table className={styles.recentTable}>
            <thead>
              <tr>
                <th>Order</th>
                <th className={styles.hideSm}>Buyer</th>
                <th className={styles.hideSm}>Date</th>
                <th>Status</th>
                <th className={styles.num}>Total</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={merchantUrl(`/sales?order=${o.id}`)}>#{o.id}</Link>
                  </td>
                  <td className={styles.hideSm}>{o.buyer_name ?? "—"}</td>
                  <td className={styles.hideSm}>{orderDate(o.ordered_at)}</td>
                  <td>
                    <span className={`${styles.statusPill} ${styles[`status_${o.status}`] ?? ""}`}>
                      {ORDER_STATUS_LABELS[o.status] ?? o.status}
                    </span>
                  </td>
                  <td className={styles.num}>{peso(o.total_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Link href={merchantUrl("/sales")} className={styles.cardLink}>
          All orders <ChevronRight size={14} />
        </Link>
      </section>
    </div>
  );
}
