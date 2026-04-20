"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import styles from "./page.module.css";

export default function ConfirmationPage() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId") ?? "CB-2026-0000";

  return (
    <div className={styles.page}>
      <section className={styles.card}>
        <div className={styles.badge}>Order Confirmed</div>
        <h1>Thank you for your order</h1>
        <p className={styles.lead}>
          Your request has been sent to partnered farms and is now queued for
          processing.
        </p>

        <div className={styles.details}>
          <div>
            <span>Order reference</span>
            <strong>{orderId}</strong>
          </div>
          <div>
            <span>Estimated delivery</span>
            <strong>1 to 2 business days</strong>
          </div>
          <div>
            <span>Payment status</span>
            <strong>Pending Confirmation</strong>
          </div>
        </div>

        <div className={styles.timeline}>
          <p>
            <strong>1.</strong> Merchant confirms stock
          </p>
          <p>
            <strong>2.</strong> Produce is prepared and packed
          </p>
          <p>
            <strong>3.</strong> Rider pickup and delivery
          </p>
        </div>

        <div className={styles.actions}>
          <Link href="/track" className={styles.primaryButton}>
            Track Order
          </Link>
          <Link href="/history" className={styles.secondaryButton}>
            View Order History
          </Link>
          <Link href="/order" className={styles.secondaryButton}>
            Place Another Order
          </Link>
        </div>
      </section>
    </div>
  );
}
