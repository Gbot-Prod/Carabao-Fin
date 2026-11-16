"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import styles from "../page.module.css";
import { formatPeso } from "../lib/format";
import getApiErrorMessage from "@/util/errorHelper";
import { fetchMySales, type MerchantSales } from "@/util/api";

const WINDOWS = [30, 90] as const;
type Window = (typeof WINDOWS)[number];

// "YYYY-MM-DD" read as a calendar date, so no timezone shifts the day.
const shortDate = (d: unknown) => {
  const [y, m, day] = String(d).split("-").map(Number);
  if (!y || !m || !day) return String(d);
  return new Date(y, m - 1, day).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
};

const tick = { fontSize: 11, fill: "#647067" };
const tooltipStyle = { fontSize: 12, borderRadius: 8, border: "1px solid #e0ece5" };

/** F2: revenue and orders per day (30 or 90 days) and top products. */
export default function SalesCharts() {
  const [days, setDays] = useState<Window>(30);
  const [data, setData] = useState<MerchantSales | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchMySales(days)
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
      })
      .catch((err) => live && setError(getApiErrorMessage(err) ?? "Could not load sales."));
    return () => {
      live = false;
    };
  }, [days]);

  return (
    <section className={styles.panel} aria-labelledby="sales-title">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <h2 className={styles.panelTitle} id="sales-title">Sales</h2>
        <div role="group" aria-label="Period" style={{ display: "flex", gap: "0.25rem" }}>
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              className={`${styles.tabBtn} ${days === w ? styles.tabBtnActive : ""}`}
              aria-pressed={days === w}
              onClick={() => setDays(w)}
            >
              Last {w} days
            </button>
          ))}
        </div>
      </div>

      {error && <p className={styles.danger} role="alert">{error}</p>}
      {!data ? (
        !error && <p className={styles.kpiSub}>Loading sales…</p>
      ) : (
        <>
          <div className={styles.panelStatRow}>
            <div className={styles.panelStat}>
              <span className={styles.panelLabel}>Revenue</span>
              <strong className={styles.panelValue}>{formatPeso(data.total_revenue)}</strong>
            </div>
            <div className={styles.panelStat}>
              <span className={styles.panelLabel}>Orders</span>
              <strong className={styles.panelValue}>{data.total_orders}</strong>
            </div>
          </div>

          {data.total_orders === 0 ? (
            <p className={styles.kpiSub}>No paid orders in the last {data.days} days yet.</p>
          ) : (
            <>
              <h3 className={styles.panelLabel}>Revenue per day</h3>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data.daily} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0ece5" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={tick} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tick={tick} tickLine={false} axisLine={false} width={48} />
                  <Tooltip
                    labelFormatter={shortDate}
                    formatter={(v) => [formatPeso(Number(v)), "Revenue"]}
                    contentStyle={tooltipStyle}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#31925d" fill="#31925d" fillOpacity={0.15} />
                </AreaChart>
              </ResponsiveContainer>

              <h3 className={styles.panelLabel}>Orders per day</h3>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={data.daily} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0ece5" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={tick} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={tick} tickLine={false} axisLine={false} width={32} />
                  <Tooltip labelFormatter={shortDate} formatter={(v) => [v, "Orders"]} contentStyle={tooltipStyle} />
                  <Bar dataKey="orders" fill="#173d25" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>

              <h3 className={styles.panelLabel}>Top products</h3>
              <ResponsiveContainer width="100%" height={Math.max(120, data.top_products.length * 36)}>
                <BarChart data={data.top_products} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0ece5" horizontal={false} />
                  <XAxis type="number" tick={tick} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={tick} tickLine={false} axisLine={false} width={110} />
                  <Tooltip
                    formatter={(v, _n, item) => [
                      `${formatPeso(Number(v))} · ${(item?.payload as { quantity?: number } | undefined)?.quantity ?? 0} sold`,
                      "Revenue",
                    ]}
                    contentStyle={tooltipStyle}
                  />
                  <Bar dataKey="revenue" fill="#31925d" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <p className={styles.kpiSub}>
                Revenue is order totals (including delivery fees) of paid, non-cancelled orders; product revenue is
                unit price × quantity.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
