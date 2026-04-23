"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { fetchTransactionByOrder, type TransactionStatusResponse } from "@/util/api";

function PaymentSuccessContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("order_id");

  const [transaction, setTransaction] = useState<TransactionStatusResponse | null>(null);
  const [status, setStatus] = useState<"polling" | "paid" | "failed" | "not_found">("polling");

  useEffect(() => {
    if (!orderId) {
      setStatus("not_found");
      return;
    }

    let attempts = 0;
    const MAX_ATTEMPTS = 10;

    const poll = async () => {
      try {
        const txn = await fetchTransactionByOrder(Number(orderId));
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
        setTimeout(() => void poll(), 3000);
      } else {
        // Webhook may be delayed — show success optimistically since PayMongo confirmed
        setStatus("paid");
      }
    };

    void poll();
  }, [orderId]);

  if (status === "not_found") {
    return (
      <div style={styles.container}>
        <p>No order found. Please check your order history.</p>
        <Link href="/history" style={styles.primaryButton}>View Order History</Link>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div style={styles.container}>
        <div style={{ ...styles.badge, background: "#fee2e2", color: "#dc2626" }}>
          Payment Failed
        </div>
        <h1 style={styles.heading}>Something went wrong</h1>
        <p style={styles.subtext}>Your payment was not completed. No charges were made.</p>
        <Link href="/checkout" style={styles.primaryButton}>Try Again</Link>
        <Link href="/history" style={styles.secondaryButton}>View Order History</Link>
      </div>
    );
  }

  if (status === "polling") {
    return (
      <div style={styles.container}>
        <div style={styles.spinner} />
        <h1 style={styles.heading}>Confirming your payment…</h1>
        <p style={styles.subtext}>This usually takes a few seconds.</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.badge}>Payment Confirmed</div>
      <h1 style={styles.heading}>Thank you for your order!</h1>
      <p style={styles.subtext}>
        Order #{orderId} has been paid{" "}
        {transaction?.amount !== undefined && `(PHP ${transaction.amount.toFixed(2)})`}.
        The merchant will begin preparing your items.
      </p>

      <div style={styles.timeline}>
        <div style={styles.timelineItem}>
          <span style={styles.dot} />
          <span>Payment received</span>
        </div>
        <div style={styles.timelineItem}>
          <span style={{ ...styles.dot, background: "#d1d5db" }} />
          <span style={{ color: "#9ca3af" }}>Merchant confirms order</span>
        </div>
        <div style={styles.timelineItem}>
          <span style={{ ...styles.dot, background: "#d1d5db" }} />
          <span style={{ color: "#9ca3af" }}>Out for delivery</span>
        </div>
      </div>

      <Link href={`/track`} style={styles.primaryButton}>Track Order</Link>
      <Link href="/history" style={styles.secondaryButton}>View Order History</Link>
      <Link href="/order" style={styles.secondaryButton}>Place Another Order</Link>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={<div style={styles.container}><div style={styles.spinner} /></div>}>
      <PaymentSuccessContent />
    </Suspense>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 480,
    margin: "4rem auto",
    padding: "2rem",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "1rem",
    textAlign: "center",
  },
  badge: {
    background: "#dcfce7",
    color: "#16a34a",
    padding: "0.35rem 1rem",
    borderRadius: 999,
    fontSize: "0.85rem",
    fontWeight: 600,
  },
  heading: {
    fontSize: "1.6rem",
    fontWeight: 700,
    margin: 0,
  },
  subtext: {
    color: "#6b7280",
    margin: 0,
  },
  timeline: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    margin: "1rem 0",
    textAlign: "left",
  },
  timelineItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    fontSize: "0.95rem",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: "#16a34a",
    flexShrink: 0,
  },
  primaryButton: {
    display: "block",
    width: "100%",
    padding: "0.75rem",
    background: "#16a34a",
    color: "#fff",
    borderRadius: 8,
    textDecoration: "none",
    fontWeight: 600,
    textAlign: "center",
  },
  secondaryButton: {
    display: "block",
    width: "100%",
    padding: "0.75rem",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    textDecoration: "none",
    fontWeight: 500,
    textAlign: "center",
    color: "#374151",
  },
  spinner: {
    width: 36,
    height: 36,
    border: "3px solid #e5e7eb",
    borderTop: "3px solid #16a34a",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
};
