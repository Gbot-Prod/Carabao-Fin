"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import { fetchMyMerchantPerformance, fetchMyProfile, type MerchantPerformance } from "@/util/api";

const formatPeso = (v: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(v);

const formatDateTime = (v?: string | null) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
};

export default function MerchantDashboardPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMerchant, setIsMerchant] = useState<boolean | null>(null);
  const [performance, setPerformance] = useState<MerchantPerformance | null>(null);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const profile = await fetchMyProfile();
        setIsMerchant(!!profile.merchant?.id);
      } catch {
        setIsMerchant(null);
      }

      try {
        const data = await fetchMyMerchantPerformance();
        setPerformance(data);
        setIsMerchant(true);
      } catch (e: any) {
        const message = e?.response?.data?.detail || "Unable to load dashboard right now.";
        setError(String(message));
        if (e?.response?.status === 404) {
          setIsMerchant(false);
        }
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, []);

  const merchantName = performance?.merchant_name ?? "Your Shop";
  const ratingLabel = useMemo(() => {
    const rating = performance?.rating;
    if (rating === null || rating === undefined) return "—";
    return `${Number(rating).toFixed(1)} / 5`;
  }, [performance?.rating]);

  if (isLoading) {
    return (
      <div className={styles.page}>
        <section className={styles.card}>
          <h1 className={styles.title}>Merchant Dashboard</h1>
          <p className={styles.subtitle}>Loading your performance data…</p>
        </section>
      </div>
    );
  }

  if (isMerchant === false) {
    return (
      <div className={styles.page}>
        <section className={styles.card}>
          <h1 className={styles.title}>Merchant Dashboard</h1>
          <p className={styles.subtitle}>You don’t have a merchant profile yet.</p>
          <div className={styles.actions}>
            <Link className={styles.primaryBtn} href="/merchantOnboarding">
              Apply as Merchant
            </Link>
            <Link className={styles.secondaryBtn} href="/profile">
              Back to Profile
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <section className={styles.card}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>{merchantName}</h1>
            <p className={styles.subtitle}>A quick snapshot of your shop performance.</p>
          </div>
          <div className={styles.headerActions}>
            <Link className={styles.secondaryBtn} href="/profile">
              Settings
            </Link>
          </div>
        </header>

        {error && <p className={styles.errorBox}>{error}</p>}

        {performance && (
          <>
            <section className={styles.kpiGrid} aria-label="Key performance indicators">
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Total revenue</span>
                <strong className={styles.kpiValue}>{formatPeso(performance.total_revenue)}</strong>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Total orders</span>
                <strong className={styles.kpiValue}>{performance.total_orders}</strong>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Active orders</span>
                <strong className={styles.kpiValue}>{performance.active_orders}</strong>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Products listed</span>
                <strong className={styles.kpiValue}>{performance.total_products}</strong>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Rating</span>
                <strong className={styles.kpiValue}>{ratingLabel}</strong>
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>Last order</span>
                <strong className={styles.kpiValue}>{formatDateTime(performance.last_order_at) ?? "—"}</strong>
              </div>
            </section>

            <section className={styles.splitRow}>
              <div className={styles.panel}>
                <h2 className={styles.panelTitle}>Last 30 days</h2>
                <div className={styles.panelGrid}>
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
                <h2 className={styles.panelTitle}>Order status</h2>
                <div className={styles.panelGrid}>
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
            </section>
          </>
        )}

        <footer className={styles.footer}>
          <Link className={styles.secondaryBtn} href="/track">
            View orders
          </Link>
          <Link className={styles.secondaryBtn} href="/merchantOnboarding">
            Update merchant details
          </Link>
        </footer>
      </section>
    </div>
  );
}

