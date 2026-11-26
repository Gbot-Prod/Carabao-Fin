"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  fetchAdminRefunds,
  recordRefund,
  refreshPaymongoRefund,
  REFUND_METHOD_LABELS,
  sendPaymongoRefund,
  type AdminRefund,
  type AdminRefundSort,
  type RefundMethod,
} from "@/util/api/admin";
import getApiErrorMessage from "@/util/errorHelper";
import FieldError, { invalidClass, invalidProps } from "@/components/FieldError/FieldError";
import styles from "../orders/page.module.css";
import own from "./page.module.css";
import PageHeader from "../../PageHeader";
import TablePanel, { TablePage, TableSearch, TableSegments, TableSort, type SortOption } from "../../TablePanel";
import SortHeader, { readSort, writeSort, type SortState } from "../../SortHeader";
import PageLoader from "@/components/PageLoader/PageLoader";

type Tab = "refund_pending" | "refunded";

const SORT_KEYS = ["id", "order", "buyer", "merchant", "amount", "paid", "refunded"] as const;
const SORT_OPTIONS: SortOption<AdminRefundSort>[] = [
  { key: "paid", label: "Paid", firstOrder: "desc" },
  { key: "refunded", label: "Refunded", firstOrder: "desc" },
  { key: "amount", label: "Amount", firstOrder: "desc" },
  { key: "buyer", label: "Buyer" },
  { key: "merchant", label: "Merchant" },
  { key: "order", label: "Order", firstOrder: "desc" },
  { key: "id", label: "Txn", firstOrder: "desc" },
];

const peso = (n: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(n);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-PH") : "—");

export default function AdminRefundsPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading refunds…" />}>
      <RefundsContent />
    </Suspense>
  );
}

function RefundsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab: Tab = searchParams.get("show") === "refunded" ? "refunded" : "refund_pending";
  const q = searchParams.get("q")?.trim() ?? "";
  // No sort: the queue oldest first, the refunded list newest refund first.
  const current = readSort<AdminRefundSort>(searchParams, SORT_KEYS);
  const { sort, order } = current;
  const key = `${tab}|${q}|${sort ?? ""}|${order}`;

  const [rows, setRows] = useState<AdminRefund[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<AdminRefund | null>(null);

  useEffect(() => {
    fetchAdminRefunds(tab, { q: q || undefined, ...(sort ? { sort, order } : {}) })
      .then((data) => {
        setRows(data);
        setError(null);
      })
      .catch(() => setError("Failed to load refunds."))
      .finally(() => setLoadedKey(`${tab}|${q}|${sort ?? ""}|${order}`));
  }, [tab, q, sort, order]);

  const loading = loadedKey !== key;
  const firstLoad = loadedKey === null;

  const go = (next: { tab?: Tab; q?: string; sort?: SortState<AdminRefundSort> }) => {
    const params = new URLSearchParams();
    const nextTab = next.tab ?? tab;
    const nextQ = next.q ?? q;
    if (nextTab === "refunded") params.set("show", "refunded");
    if (nextQ) params.set("q", nextQ);
    writeSort(params, next.sort ?? current);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };
  const onSort = (next: SortState<AdminRefundSort>) => go({ sort: next });

  const onRecorded = (txn: AdminRefund) => {
    setRows((prev) => prev.filter((r) => r.transaction_id !== txn.transaction_id));
    setRecording(null);
  };

  // One PayMongo call at a time per row; its error shows in that row.
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});

  const onRowUpdated = (txn: AdminRefund) => {
    if (txn.status === "refunded") onRecorded(txn);
    else setRows((prev) => prev.map((r) => (r.transaction_id === txn.transaction_id ? txn : r)));
  };

  const callPaymongo = async (r: AdminRefund, action: "send" | "refresh") => {
    if (
      action === "send" &&
      !window.confirm(
        `Refund ${peso(r.amount)} to ${r.buyer_name ?? r.buyer_email ?? "the buyer"} through PayMongo? ` +
          "PayMongo takes it from the Carabao balance.",
      )
    )
      return;
    setBusyId(r.transaction_id);
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[r.transaction_id];
      return next;
    });
    try {
      const txn = await (action === "send" ? sendPaymongoRefund : refreshPaymongoRefund)(r.transaction_id);
      onRowUpdated(txn);
    } catch (err) {
      const message = getApiErrorMessage(err) ?? "PayMongo could not be reached. Try again.";
      setRowErrors((prev) => ({ ...prev, [r.transaction_id]: message }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <TablePage>
      <PageHeader
        eyebrow="Money"
        title="Refunds"
        count={!loading ? rows.length : undefined}
        description="Refund the whole payment through PayMongo, or send it back another way (GCash, Maya, bank) and record the method and reference here. The buyer is notified by email and SMS."
      />

      <TablePanel
        filters={
          <TableSegments
            label="Show refunds"
            options={[
              { value: "refund_pending" as Tab, label: "To refund" },
              { value: "refunded" as Tab, label: "Refunded" },
            ]}
            value={tab}
            // A sort on "Refunded" means nothing in the queue: start each list in its own order.
            onChange={(t) => go({ tab: t, sort: { sort: null, order: "asc" } })}
          />
        }
        sort={
          <TableSort
            options={tab === "refunded" ? SORT_OPTIONS : SORT_OPTIONS.filter((o) => o.key !== "refunded")}
            current={current}
            onSort={onSort}
            defaultLabel={tab === "refunded" ? "Newest refund first" : "Oldest first (queue)"}
          />
        }
        search={<TableSearch applied={q} onSearch={(v) => go({ q: v })} placeholder="Buyer, merchant, #order or ref" label="Search refunds" />}
        message={
          firstLoad
            ? "Loading refunds…"
            : error ??
              (rows.length === 0
                ? q
                  ? "No refunds match this search."
                  : tab === "refund_pending"
                  ? "No payments are waiting for a refund."
                  : "No refunds recorded yet."
                : null)
        }
        messageTone={!firstLoad && error ? "error" : undefined}
        loading={loading}
        count={rows.length}
      >
          <table>
            <thead>
              <tr>
                <SortHeader label="Txn" sortKey="id" current={current} onSort={onSort} firstOrder="desc" />
                <SortHeader label="Order" sortKey="order" current={current} onSort={onSort} firstOrder="desc" />
                <SortHeader label="Buyer" sortKey="buyer" current={current} onSort={onSort} />
                <SortHeader label="Merchant" sortKey="merchant" current={current} onSort={onSort} />
                <SortHeader label="Amount" sortKey="amount" current={current} onSort={onSort} firstOrder="desc" />
                <SortHeader label="Paid" sortKey="paid" current={current} onSort={onSort} firstOrder="desc" />
                {tab === "refunded" ? (
                  <>
                    <th>Method</th>
                    <th>Reference</th>
                    <SortHeader label="Refunded" sortKey="refunded" current={current} onSort={onSort} firstOrder="desc" />
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
                    <td className={own.actionCell}>
                      <RefundActions
                        txn={r}
                        busy={busyId === r.transaction_id}
                        error={rowErrors[r.transaction_id]}
                        onSend={() => void callPaymongo(r, "send")}
                        onRefresh={() => void callPaymongo(r, "refresh")}
                        onRecord={() => setRecording(r)}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
      </TablePanel>

      {recording && <RecordRefundDialog txn={recording} onClose={() => setRecording(null)} onDone={onRecorded} />}
    </TablePage>
  );
}

/** The "To refund" row's buttons and the state of a refund sent to PayMongo. */
function RefundActions({
  txn,
  busy,
  error,
  onSend,
  onRefresh,
  onRecord,
}: {
  txn: AdminRefund;
  busy: boolean;
  error?: string;
  onSend: () => void;
  onRefresh: () => void;
  onRecord: () => void;
}) {
  const status = txn.paymongo_refund_status ?? null;
  return (
    <div className={own.actions}>
      {status === "processing" ? (
        <>
          <span className={`${styles.badge} ${own.processing}`}>Processing at PayMongo</span>
          <button type="button" className={own.secondary} onClick={onRefresh} disabled={busy}>
            {busy ? "Checking…" : "Refresh"}
          </button>
        </>
      ) : (
        <>
          {txn.can_send_paymongo && (
            <button type="button" className={own.primary} onClick={onSend} disabled={busy}>
              {busy ? "Sending…" : status === "failed" ? "Try PayMongo again" : "Refund via PayMongo"}
            </button>
          )}
          <button
            type="button"
            className={txn.can_send_paymongo ? own.secondary : own.primary}
            onClick={onRecord}
            disabled={busy}
          >
            Record manually
          </button>
        </>
      )}
      {status === "failed" && txn.refund_failure_reason && (
        <p className={own.rowError}>PayMongo: {txn.refund_failure_reason}</p>
      )}
      {status === "unknown" && (
        <p className={own.rowError}>{txn.refund_failure_reason ?? "Check the PayMongo dashboard, then record the refund."}</p>
      )}
      {!txn.paymongo_payment_id && <p className={styles.sub}>No PayMongo payment ID: record it manually.</p>}
      {error && (
        <p className={own.rowError} role="alert">
          {error}
        </p>
      )}
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
  const [referenceError, setReferenceError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reference.trim()) {
      setReferenceError("Enter the refund reference.");
      document.getElementById("refund-reference")?.focus();
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
          <label className={`${styles.field}${invalidClass(referenceError)}`}>
            <span>Reference</span>
            <input
              id="refund-reference"
              value={reference}
              onChange={(e) => {
                setReference(e.target.value);
                setReferenceError(null);
              }}
              placeholder="PayMongo refund ID, GCash or bank reference"
              maxLength={200}
              {...invalidProps("refund-reference", referenceError)}
            />
            <FieldError id="refund-reference" message={referenceError} />
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
