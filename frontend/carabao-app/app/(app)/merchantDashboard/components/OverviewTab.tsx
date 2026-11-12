import { useMemo, useState } from "react";
import styles from "../page.module.css";
import { formatDate, formatPeso } from "../lib/format";
import type { MerchantPerformance, Produce } from "@/util/api";
import StockAlertsPanel from "./StockAlertsPanel";
import SalesCharts from "./SalesCharts";
import DemandInsight from "./DemandInsight";

type Props = {
  performance: MerchantPerformance;
  produces: Produce[];
  onOpenReviews: () => void;
  onOpenOrders: () => void;
};

export default function OverviewTab({ performance, produces, onOpenReviews, onOpenOrders }: Props) {
  // The merchant's own low-stock threshold (F1); 5 until the alerts load.
  const [threshold, setThreshold] = useState(5);
  const isLow = (qty: number) => qty > 0 && threshold > 0 && qty <= threshold;
  const stock = useMemo(() => {
    const total = produces.reduce((acc, p) => acc + p.price * p.stock_quantity, 0);
    const outOfStock = produces.filter((p) => p.stock_quantity === 0).length;
    const lowStock = produces.filter((p) => p.stock_quantity > 0 && threshold > 0 && p.stock_quantity <= threshold).length;
    return { total, outOfStock, lowStock };
  }, [produces, threshold]);

  const ratingLabel = performance.rating == null ? "—" : `${Number(performance.rating).toFixed(1)} / 5`;
  const ratingCount = performance.rating_count ?? 0;

  return (
    <div className={styles.overviewLayout}>
      <section className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Total Revenue</span>
          <strong className={styles.kpiValue}>{formatPeso(performance.total_revenue)}</strong>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Total Orders</span>
          <strong className={styles.kpiValue}>{performance.total_orders}</strong>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Active Orders</span>
          <strong className={styles.kpiValue}>{performance.active_orders}</strong>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Products Listed</span>
          <strong className={styles.kpiValue}>{performance.total_products}</strong>
        </div>
        <button type="button" className={`${styles.kpiCard} ${styles.kpiCardButton}`} onClick={onOpenReviews}>
          <span className={styles.kpiLabel}>Rating</span>
          <strong className={styles.kpiValue}>{ratingLabel}</strong>
          <span className={styles.kpiSub}>
            {ratingCount ? `${ratingCount} review${ratingCount === 1 ? "" : "s"} →` : "No reviews yet"}
          </span>
        </button>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Last Order</span>
          <strong className={styles.kpiValue}>{formatDate(performance.last_order_at)}</strong>
        </div>
      </section>

      <div className={styles.overviewRow}>
        <div className={styles.panel}>
          <h2 className={styles.panelTitle}>Last 30 Days</h2>
          <div className={styles.panelStatRow}>
            <div className={styles.panelStat}>
              <span className={styles.panelLabel}>Orders</span>
              <strong className={styles.panelValue}>{performance.last_30_days_orders}</strong>
            </div>
            <div className={styles.panelStat}>
              <span className={styles.panelLabel}>Revenue</span>
              <strong className={styles.panelValue}>{formatPeso(performance.last_30_days_revenue)}</strong>
            </div>
          </div>
        </div>

        <div className={styles.panel}>
          <h2 className={styles.panelTitle}>Order Status</h2>
          <div className={styles.panelStatRow}>
            <div className={styles.panelStat}>
              <span className={styles.panelLabel}>Delivered</span>
              <strong className={styles.panelValue}>{performance.delivered_orders}</strong>
            </div>
            <div className={styles.panelStat}>
              <span className={styles.panelLabel}>Cancelled</span>
              <strong className={styles.panelValue}>{performance.cancelled_orders}</strong>
            </div>
          </div>
        </div>

        <div className={styles.panel}>
          <h2 className={styles.panelTitle}>Inventory</h2>
          <div className={styles.panelStatRow}>
            <div className={styles.panelStat}>
              <span className={styles.panelLabel}>Inventory Value</span>
              <strong className={styles.panelValue}>{formatPeso(stock.total)}</strong>
            </div>
            <div className={styles.panelStat}>
              <span className={styles.panelLabel}>Out of Stock</span>
              <strong className={`${styles.panelValue} ${stock.outOfStock > 0 ? styles.danger : ""}`}>{stock.outOfStock}</strong>
            </div>
            <div className={styles.panelStat}>
              <span className={styles.panelLabel}>Low Stock</span>
              <strong className={`${styles.panelValue} ${stock.lowStock > 0 ? styles.warning : ""}`}>{stock.lowStock}</strong>
            </div>
          </div>
        </div>
      </div>

      <SalesCharts />

      <DemandInsight />

      <StockAlertsPanel refreshKey={produces} onThreshold={setThreshold} />

      {produces.length > 0 && (
        <div className={styles.panel}>
          <h2 className={styles.panelTitle}>Stock by Produce</h2>
          <table className={styles.stockTable}>
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {produces.map((p) => {
                const status = p.stock_quantity === 0 ? "out" : isLow(p.stock_quantity) ? "low" : "ok";
                return (
                  <tr key={p.id}>
                    <td className={styles.stockName}>{p.name}</td>
                    <td className={styles.stockCategory}>{p.category ?? "—"}</td>
                    <td>₱{p.price} / {p.unit}</td>
                    <td>{p.stock_quantity}</td>
                    <td>{formatPeso(p.price * p.stock_quantity)}</td>
                    <td>
                      <span className={`${styles.stockBadge} ${styles[`stockBadge_${status}`]}`}>
                        {status === "out" ? "Out of Stock" : status === "low" ? "Low Stock" : "In Stock"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.overviewActions}>
        <button className={styles.secondaryBtn} onClick={onOpenOrders}>View All Orders</button>
      </div>
    </div>
  );
}
