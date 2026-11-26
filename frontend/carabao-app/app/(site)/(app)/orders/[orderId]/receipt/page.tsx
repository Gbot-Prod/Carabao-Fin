"use client";

// CF-0049 (B09): printable receipt for a paid order. "Print" uses the
// browser's print dialog, which can also save it as a PDF.

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import axios from "axios";
import styles from "./page.module.css";
import PageLoader from "@/components/PageLoader/PageLoader";
import { LoadError } from "@/components/Skeleton/Skeleton";
import { fetchOrderReceipt, type OrderReceipt } from "@/util/api/orders";
import { receiptPeso, refundNote, shortReference } from "@/lib/receipt";

const formatDateTime = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("en-PH", {
        year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
        timeZone: "Asia/Manila",
      })
    : "—";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; receipt: OrderReceipt }
  | { kind: "missing" }
  | { kind: "unpaid" }
  | { kind: "error" };

export default function OrderReceiptPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = Number(params.orderId);
  const valid = Number.isInteger(orderId) && orderId > 0;
  const [state, setState] = useState<LoadState>(valid ? { kind: "loading" } : { kind: "missing" });

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!valid) return;
    let live = true;
    fetchOrderReceipt(orderId)
      .then((receipt) => live && setState({ kind: "ready", receipt }))
      .catch((err: unknown) => {
        if (!live) return;
        const code = axios.isAxiosError(err) ? err.response?.status : undefined;
        setState({ kind: code === 404 ? "missing" : code === 409 ? "unpaid" : "error" });
      });
    return () => {
      live = false;
    };
  }, [orderId, valid, attempt]);

  const back = valid ? `/orders/${orderId}` : "/orders";

  if (state.kind === "loading") return <PageLoader />;
  if (state.kind !== "ready") {
    return (
      <div className={styles.container}>
        <Link href={back} className={styles.back}>← Back to order</Link>
        {state.kind === "error" ? (
          <LoadError
            message="The receipt could not be loaded."
            onRetry={() => {
              setState({ kind: "loading" });
              setAttempt((n) => n + 1);
            }}
          />
        ) : (
          <p className={styles.notice} role="status">
            {state.kind === "unpaid"
              ? "This order has no payment yet, so there is no receipt."
              : "Order not found."}
          </p>
        )}
      </div>
    );
  }

  const r = state.receipt;
  const note = refundNote(r.payment_status);

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <Link href={back} className={styles.back}>← Back to order</Link>
        <button type="button" className={styles.printBtn} onClick={() => window.print()}>
          Print or save as PDF
        </button>
      </div>

      <article className={styles.receipt} aria-labelledby="receipt-title">
        <header className={styles.head}>
          <div>
            <p className={styles.brand}>Carabao</p>
            <h1 id="receipt-title" className={styles.title}>Receipt</h1>
            {r.document_label && <p className={styles.documentLabel}>{r.document_label}</p>}
          </div>
          <dl className={styles.meta}>
            <dt>Receipt no.</dt><dd>{r.receipt_number}</dd>
            <dt>Paid</dt><dd>{formatDateTime(r.paid_at)}</dd>
            <dt>Ordered</dt><dd>{formatDateTime(r.ordered_at)}</dd>
            {r.payment_reference && (
              <>
                <dt>Payment ref.</dt>
                <dd title={r.payment_reference}>{shortReference(r.payment_reference)}</dd>
              </>
            )}
          </dl>
        </header>

        <div className={styles.parties}>
          <section>
            <h2>Sold by</h2>
            <p>{r.farm_name ?? "—"}</p>
            {r.farm_town && <p>{r.farm_town}</p>}
            {r.farm_contact_number && <p>{r.farm_contact_number}</p>}
          </section>
          <section>
            <h2>Billed to</h2>
            <p>{r.buyer_name ?? "—"}</p>
            {r.delivery_address && <p>{r.delivery_address}</p>}
          </section>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className={styles.num}>Qty</th>
                <th scope="col" className={styles.num}>Unit price</th>
                <th scope="col" className={styles.num}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((line, i) => (
                <tr key={`${line.name}-${i}`}>
                  <td>{line.name}{line.unit ? ` (${line.unit})` : ""}</td>
                  <td className={styles.num}>{line.quantity}</td>
                  <td className={styles.num}>{receiptPeso(line.unit_price)}</td>
                  <td className={styles.num}>{receiptPeso(line.line_total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>Subtotal</th>
                <td className={styles.num}>{receiptPeso(r.subtotal)}</td>
              </tr>
              <tr>
                <th scope="row" colSpan={3}>Delivery</th>
                <td className={styles.num}>{receiptPeso(r.delivery_fee)}</td>
              </tr>
              <tr className={styles.totalRow}>
                <th scope="row" colSpan={3}>Total paid</th>
                <td className={styles.num}>{receiptPeso(r.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {note && <p className={styles.refund}>{note}</p>}
        <p className={styles.footer}>Paid online through PayMongo. Order #{r.order_id}.</p>
      </article>
    </div>
  );
}
