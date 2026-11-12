"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  fetchAdminRefunds,
  recordRefund,
  REFUND_METHOD_LABELS,
  type AdminRefund,
  type RefundMethod,
} from "@/util/api/admin";
import getApiErrorMessage from "@/util/errorHelper";
import PageLoader from "@/components/PageLoader/PageLoader";
import styles from "../orders/page.module.css";
import own from "./page.module.css";

type Tab = "refund_pending" | "refunded";

const peso = (n: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(n);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-PH") : "—");

export default function AdminRefundsPage() {
  const [tab, setTab] = useState<Tab>("refund_pending");
  const [rows, setRows] = useState<AdminRefund[]>([]);
  const [loadedTab, setLoadedTab] = useState<Tab | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<AdminRefund | null>(null);

  useEffect(() => {
    fetchAdminRefunds(tab)
      .then((data) => {
        setRows(data);
        setError(null);
      })
      .catch(() => setError("Failed to load refunds."))
      .finally(() => setLoadedTab(tab));
  }, [tab]);

  const loading = loadedTab !== tab;

  const onRecorded = (txn: AdminRefund) => {
    setRows((prev) => prev.filter((r) => r.transaction_id !== txn.transaction_id));
    setRecording(null);
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>
        Refunds {tab === "refund_pending" && !loading && <span className={styles.count}>{rows.length}</span>}
      </h1>
      <p className={own.intro}>
        Send the money back outside Carabao (PayMongo dashboard, GCash, Maya or bank), then record the method and reference here. The buyer is notified by email and SMS.
      </p>

      <div className={own.tabs} role="tablist">
        {(["refund_pending", "refunded"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`${own.tab} ${tab === t ? own.tabActive : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "refund_pending" ? "To refund" : "Refunded"}
          </button>
        ))}
      </div>

      {loading ? (
        <PageLoader label="Loading refunds…" />
      ) : error ? (
        <div className={styles.stateError}>{error}</div>
      ) : rows.length === 0 ? (
        <div className={styles.state}>
          {tab === "refund_pending" ? "No payments are waiting for a refund." : "No refunds recorded yet."}
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Txn</th>
                <th>Order</th>
                <th>Buyer</th>
                <th>Merchant</th>
                <th>Amount</th>
                <th>Paid</th>
                {tab === "refunded" ? (
                  <>
                    <th>Method</th>
                    <th>Reference</th>
                    <th>Refunded</th>
                  </>
                ) : (
                  <th />
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.transaction_id}>
                  <td className={styles.mono}>#{r.transaction_id}</td>
                  <td>
                    <Link className={styles.linkButton} href={`/admin/orders?order=${r.order_id}`}>#{r.order_id}</Link>
                    <span className={styles.sub}> · {r.order_status.replace(/_/g, " ")}</span>
                  </td>
                  <td>
                    {r.buyer_name ?? r.buyer_email ?? "—"}
                    {r.buyer_name && r.buyer_email && <div className={styles.sub}>{r.buyer_email}</div>}
                  </td>
                  <td>{r.merchant_name ?? "—"}</td>
                  <td className={styles.mono}>{peso(r.amount)}</td>
                  <td className={styles.mono}>{when(r.paid_at)}</td>
                  {tab === "refunded" ? (
                    <>
                      <td>{r.refund_method ? REFUND_METHOD_LABELS[r.refund_method] : "—"}</td>
                      <td className={styles.mono}>{r.refund_reference ?? "—"}</td>
                      <td className={styles.mono}>{when(r.refunded_at)}</td>
                    </>
                  ) : (
                    <td>
                      <button type="button" className={own.primary} onClick={() => setRecording(r)}>
                        Record refund
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recording && <RecordRefundDialog txn={recording} onClose={() => setRecording(null)} onDone={onRecorded} />}
    </div>
  );
}

function RecordRefundDialog({
  txn,
  onClose,
  onDone,
}: {
  txn: AdminRefund;
  onClose: () => void;
  onDone: (txn: AdminRefund) => void;
}) {
  const [method, setMethod] = useState<RefundMethod>("paymongo");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reference.trim()) {
      setError("Enter the refund reference.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await recordRefund(txn.transaction_id, {
        method,
        reference: reference.trim(),
        notes: notes.trim() || undefined,
      });
      onDone(saved);
    } catch (err) {
      setError(getApiErrorMessage(err) ?? "Could not record the refund.");
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <aside className={styles.panel} role="dialog" aria-label="Record refund" onClick={(e) => e.stopPropagation()}>
        <div className={styles.panelHeader}>
          <h2>Record refund</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>
        </div>
        <p className={own.summary}>
          {peso(txn.amount)} to {txn.buyer_name ?? txn.buyer_email ?? "the buyer"} for order #{txn.order_id}
          {txn.paymongo_payment_id && <span className={styles.sub}> · PayMongo payment {txn.paymongo_payment_id}</span>}
        </p>
        <form className={own.form} onSubmit={submit}>
          <label className={styles.field}>
            <span>Method</span>
            <select value={method} onChange={(e) => setMethod(e.target.value as RefundMethod)}>
              {(Object.keys(REFUND_METHOD_LABELS) as RefundMethod[]).map((m) => (
                <option key={m} value={m}>{REFUND_METHOD_LABELS[m]}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Reference</span>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="PayMongo refund ID, GCash or bank reference"
              maxLength={200}
              required
            />
          </label>
          <label className={styles.field}>
            <span>Notes (optional)</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={1000} />
          </label>
          {error && <p className={styles.stateError} role="alert">{error}</p>}
          <button type="submit" className={own.primary} disabled={saving}>
            {saving ? "Saving…" : "Mark as refunded"}
          </button>
        </form>
      </aside>
    </div>
  );
}
