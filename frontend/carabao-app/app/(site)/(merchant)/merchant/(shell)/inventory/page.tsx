"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { merchantUrl } from "@/lib/urls";
import { useMerchant } from "../../MerchantContext";
import MerchantPage from "../../MerchantPage";
import StockAlertsPanel from "../../components/StockAlertsPanel";
import DemandInsight from "../../components/DemandInsight";
import { formatPeso } from "../../lib/format";
import styles from "../../page.module.css";

// Stock levels, the merchant's low-stock threshold and best-before alerts (F1),
// and what buyers near the farm order and search for (F3).
export default function MerchantInventoryPage() {
  const { produces, produceLoading } = useMerchant();
  // The merchant's own low-stock threshold; 5 until the alerts load.
  const [threshold, setThreshold] = useState(5);
  const isLow = (qty: number) => qty > 0 && threshold > 0 && qty <= threshold;

  const stock = useMemo(() => {
    const total = produces.reduce((acc, p) => acc + p.price * p.stock_quantity, 0);
    const outOfStock = produces.filter((p) => p.stock_quantity === 0).length;
    const lowStock = produces.filter((p) => p.stock_quantity > 0 && threshold > 0 && p.stock_quantity <= threshold).length;
    return { total, outOfStock, lowStock };
  }, [produces, threshold]);

  // Out of stock first, then low, then the rest by name.
  const rows = useMemo(() => {
    const rank = (qty: number) => (qty === 0 ? 0 : qty > 0 && threshold > 0 && qty <= threshold ? 1 : 2);
    return [...produces].sort((a, b) => rank(a.stock_quantity) - rank(b.stock_quantity) || (a.name ?? "").localeCompare(b.name ?? ""));
  }, [produces, threshold]);

  return (
    <MerchantPage
      eyebrow="Store"
      title="Inventory"
      description="Stock levels, low-stock and best-before alerts, and what buyers near your farm want."
      actions={
        <Link className={styles.secondaryBtn} href={merchantUrl("/produce")}>
          Change stock
        </Link>
      }
    >
      <div className={styles.overviewLayout}>
        <div className={styles.overviewRow}>
          <div className={styles.panel}>
            <h2 className={styles.panelTitle}>Inventory value</h2>
            <div className={styles.panelStatRow}>
              <div className={styles.panelStat}>
                <span className={styles.panelLabel}>Price × stock</span>
                <strong className={styles.panelValue}>{formatPeso(stock.total)}</strong>
              </div>
            </div>
          </div>
          <div className={styles.panel}>
            <h2 className={styles.panelTitle}>Out of stock</h2>
            <div className={styles.panelStatRow}>
              <div className={styles.panelStat}>
                <span className={styles.panelLabel}>Listings</span>
                <strong className={`${styles.panelValue} ${stock.outOfStock > 0 ? styles.danger : ""}`}>{stock.outOfStock}</strong>
              </div>
            </div>
          </div>
          <div className={styles.panel}>
            <h2 className={styles.panelTitle}>Low stock</h2>
            <div className={styles.panelStatRow}>
              <div className={styles.panelStat}>
                <span className={styles.panelLabel}>At or below {threshold}</span>
                <strong className={`${styles.panelValue} ${stock.lowStock > 0 ? styles.warning : ""}`}>{stock.lowStock}</strong>
              </div>
            </div>
          </div>
        </div>

        <StockAlertsPanel refreshKey={produces} onThreshold={setThreshold} />

        <div className={styles.panel}>
          <h2 className={styles.panelTitle}>Stock by produce</h2>
          {produceLoading && produces.length === 0 ? (
            <p className={styles.emptyText}>Loading…</p>
          ) : produces.length === 0 ? (
            <p className={styles.emptyText}>
              No listings yet. <Link href={merchantUrl("/produce")}>Add your first produce.</Link>
            </p>
          ) : (
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
                {rows.map((p) => {
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
          )}
        </div>

        <DemandInsight />
      </div>
    </MerchantPage>
  );
}
