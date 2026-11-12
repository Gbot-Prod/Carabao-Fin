import Link from "next/link";
import styles from "../page.module.css";
import type { MerchantPerformance } from "@/util/api";
import { formatPeso } from "../lib/format";

type Props = {
  performance: MerchantPerformance | null;
  logoUrl?: string | null;
};

export default function DashboardHeader({ performance, logoUrl }: Props) {
  return (
    <header className={styles.dashHeader}>
      <div className={styles.dashHeaderLeft}>
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className={styles.dashLogo} />
        )}
        <div>
          <h1 className={styles.dashName}>{performance?.merchant_name ?? "Your Shop"}</h1>
          <p className={styles.dashSub}>Merchant Dashboard</p>
        </div>
      </div>
      <div className={styles.dashHeaderRight}>
        {performance && (
          <>
          <div className={styles.quickStats}>
            <div className={styles.quickStat}>
              <span className={styles.quickStatLabel}>Revenue</span>
              <span className={styles.quickStatValue}>{formatPeso(performance.total_revenue)}</span>
            </div>
            <div className={styles.quickStat}>
              <span className={styles.quickStatLabel}>Orders</span>
              <span className={styles.quickStatValue}>{performance.total_orders}</span>
            </div>
            <div className={styles.quickStat}>
              <span className={styles.quickStatLabel}>Active</span>
              <span className={styles.quickStatValue}>{performance.active_orders}</span>
            </div>
          </div>
          <Link className={styles.viewShopBtn} href={`/merchant/${performance.merchant_id}`} target="_blank">
            View Shop ↗
          </Link>
          </>
        )}
      </div>
    </header>
  );
}
