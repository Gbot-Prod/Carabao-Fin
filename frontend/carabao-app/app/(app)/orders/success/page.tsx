"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import styles from "./page.module.css";
import { fetchTransactionByOrder, type TransactionStatusResponse } from "@/util/api";

function PaymentSuccessContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("order_id");

  const [transaction, setTransaction] = useState<TransactionStatusResponse | null>(null);
  const [status, setStatus] = useState<"polling" | "paid" | "failed" | "not_found" | "timeout">(
    orderId ? "polling" : "not_found",
  );

  useEffect(() => {
    if (!orderId) {
      return;
    }

    let attempts = 0;
    let timeoutId: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const MAX_ATTEMPTS = 10;

    const poll = async () => {
      if (cancelled) return;
      try {
        const txn = await fetchTransactionByOrder(Number(orderId));
        if (cancelled) return;
        setTransaction(txn);

        if (txn.status === "paid") {
          setStatus("paid");
          return;
        }
        if (txn.status === "failed" || txn.status === "expired") {
          setStatus("failed");
          return;
        }
      } catch {
        // transaction not created yet or network blip — keep polling
      }

      attempts += 1;
      if (attempts < MAX_ATTEMPTS) {
        timeoutId = setTimeout(() => void poll(), 3000);
      } else {
        setStatus("timeout");
      }
    };

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [orderId]);

  if (status === "not_found") {
    return (
      <div className={styles.container}>
        <p>No order found. Please check your order history.</p>
        <Link href="/orders" className={styles.primaryButton}>View Order History</Link>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className={styles.container}>
        <div className={`${styles.badge} ${styles.badgeFailed}`}>
          Payment Failed
        </div>
        <h1 className={styles.heading}>Something went wrong</h1>
        <p className={styles.subtext}>Your payment was not completed. No charges were made.</p>
        <Link href="/checkout" className={styles.primaryButton}>Try Again</Link>
        <Link href="/orders" className={styles.secondaryButton}>View Order History</Link>
      </div>
    );
  }

  if (status === "polling") {
    return (
      <div className={styles.container}>
        <div className={styles.spinner} />
        <h1 className={styles.heading}>Confirming your payment…</h1>
        <p className={styles.subtext}>This usually takes a few seconds.</p>
      </div>
    );
  }

  if (status === "timeout") {
    return (
      <div className={styles.container}>
        <div className={`${styles.badge} ${styles.badgePending}`}>
          Payment Pending
        </div>
        <h1 className={styles.heading}>Still confirming your payment</h1>
        <p className={styles.subtext}>
          This is taking longer than usual. Check your order history in a few minutes — if payment went through it will appear there.
        </p>
        <Link href="/orders" className={styles.primaryButton}>View Order History</Link>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.badge}>Payment Confirmed</div>
      <h1 className={styles.heading}>Thank you for your order!</h1>
      <p className={styles.subtext}>
        Order #{orderId} has been paid{" "}
        {transaction?.amount !== undefined && `(PHP ${transaction.amount.toFixed(2)})`}.
        The merchant will begin preparing your items.
      </p>

      <div className={styles.timeline}>
        <div className={styles.timelineItem}>
          <span className={styles.dot} />
          <span>Payment received</span>
        </div>
        <div className={`${styles.timelineItem} ${styles.timelineItemPending}`}>
          <span className={styles.dot} />
          <span>Merchant confirms order</span>
        </div>
        <div className={`${styles.timelineItem} ${styles.timelineItemPending}`}>
          <span className={styles.dot} />
          <span>Out for delivery</span>
        </div>
      </div>

      <Link href={`/track`} className={styles.primaryButton}>Track Order</Link>
      <Link href="/orders" className={styles.secondaryButton}>View Order History</Link>
      <Link href="/order" className={styles.secondaryButton}>Place Another Order</Link>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={<div className={styles.container}><div className={styles.spinner} /></div>}>
      <PaymentSuccessContent />
    </Suspense>
  );
}
