import { useCallback, useEffect, useState } from "react";
import styles from "../page.module.css";
import own from "./disputes.module.css";
import PageLoader from "@/components/PageLoader/PageLoader";
import FieldError, { invalidClass, invalidProps } from "@/components/FieldError/FieldError";
import {
  DISPUTE_NOTE_MAX,
  fetchMerchantDisputes,
  setMerchantDisputeNote,
  type MerchantDispute,
} from "@/util/api";
import getApiErrorMessage from "@/util/errorHelper";
import { formatDate, formatPeso } from "../lib/format";

type Props = {
  /** "View order" opens the order on the Orders page. */
  onViewOrder: (orderId: number) => void;
  /** How many disputes are open, for the page header. */
  onOpenCount?: (count: number) => void;
};

function statusOf(d: MerchantDispute): { label: string; tone: string } {
  if (d.open) return { label: "Payout on hold", tone: own.hold };
  if (d.resolution === "release") return { label: "Payout released", tone: own.released };
  return { label: "Buyer refunded", tone: own.refunded };
}

/**
 * Deliveries a buyer said they did not get (backend delivery_dispute.py).
 * While Carabao checks, the farm can add its side; the admin reads it with the
 * drop-off photo before deciding.
 */
export default function DisputesTab({ onViewOrder, onOpenCount }: Props) {
  const [rows, setRows] = useState<MerchantDispute[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchMerchantDisputes();
      setRows(data);
      onOpenCount?.(data.filter((d) => d.open).length);
    } catch {
      setError("Failed to load disputes. Please try again.");
    }
  }, [onOpenCount]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (d: MerchantDispute) => {
    setEditing(d.order_id);
    setDraft(d.merchant_note ?? "");
    setNoteError(null);
  };

  const close = () => {
    setEditing(null);
    setDraft("");
    setNoteError(null);
  };

  const save = async (d: MerchantDispute) => {
    const note = draft.trim();
    if (!note) {
      setNoteError("Write what happened with this delivery.");
      document.getElementById(`dispute-note-${d.order_id}`)?.focus();
      return;
    }
    setBusy(true);
    setNoteError(null);
    try {
      const saved = await setMerchantDisputeNote(d.order_id, note);
      setRows((prev) => (prev ?? []).map((r) => (r.order_id === saved.order_id ? saved : r)));
      close();
    } catch (err) {
      setNoteError(getApiErrorMessage(err, "Could not save your reply. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const openRows = rows?.filter((d) => d.open) ?? [];
  const decidedRows = rows?.filter((d) => !d.open) ?? [];

  const card = (d: MerchantDispute) => {
    const status = statusOf(d);
    const fieldId = `dispute-note-${d.order_id}`;
    return (
      <article key={d.order_id} className={styles.reviewCard}>
        <div className={styles.reviewCardHeader}>
          <span className={`${own.badge} ${status.tone}`}>{status.label}</span>
          <span className={styles.orderBuyerName}>
            Order {d.order_ref} · {formatPeso(d.total_amount)}
          </span>
          <span className={styles.orderDate}>Reported {formatDate(d.disputed_at)}</span>
        </div>
        <p className={styles.reviewComment}>
          {d.item_summary}. Delivered {formatDate(d.delivered_at)}.{" "}
          {d.open
            ? "The buyer says it did not arrive. Carabao is checking your drop-off photo."
            : d.resolution === "release"
              ? `Carabao checked the photo on ${formatDate(d.resolved_at)}: you can claim this order's earnings.`
              : `Carabao refunded the buyer on ${formatDate(d.resolved_at)}. This order is not paid out.`}
        </p>

        {editing === d.order_id ? (
          <form
            className={styles.reviewReplyForm}
            onSubmit={(e) => {
              e.preventDefault();
              void save(d);
            }}
          >
            <div className={`${own.field}${invalidClass(noteError)}`}>
              <label className={styles.reviewReplyLabel} htmlFor={fieldId}>
                Your side, for Carabao only
              </label>
              <textarea
                id={fieldId}
                className={styles.reviewReplyInput}
                value={draft}
                maxLength={DISPUTE_NOTE_MAX}
                rows={4}
                placeholder="Who received it, where you left it, the time, anything that helps."
                onChange={(e) => {
                  setDraft(e.target.value);
                  setNoteError(null);
                }}
                {...invalidProps(fieldId, noteError)}
              />
              <FieldError id={fieldId} message={noteError} />
            </div>
            <div className={styles.reviewReplyActions}>
              <button type="submit" className={styles.primaryBtn} disabled={busy}>
                {busy ? "Sending…" : "Send to Carabao"}
              </button>
              <button type="button" className={styles.secondaryBtn} onClick={close} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        ) : d.merchant_note ? (
          <div className={styles.reviewReply}>
            <p className={styles.reviewReplyLabel}>
              Your side{d.merchant_noted_at ? ` · ${formatDate(d.merchant_noted_at)}` : ""}
            </p>
            <p className={styles.reviewComment}>{d.merchant_note}</p>
          </div>
        ) : null}

        <div className={styles.reviewReplyActions}>
          {d.open && editing !== d.order_id && (
            <button type="button" className={styles.linkBtn} onClick={() => open(d)}>
              {d.merchant_note ? "Edit your side" : "Add your side"}
            </button>
          )}
          <button type="button" className={styles.reviewOrderLink} onClick={() => onViewOrder(d.order_id)}>
            View order →
          </button>
        </div>
      </article>
    );
  };

  if (rows === null && !error) return <PageLoader variant="compact" label="Loading disputes…" />;

  return (
    <div className={styles.fillPage}>
      {error && (
        <div className={styles.reviewError}>
          <p className={`${styles.emptyText} ${styles.errorText}`}>{error}</p>
          <button className={styles.secondaryBtn} onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {rows && (
        <>
          <section className={`${styles.panel} ${styles.listPanel}`} aria-labelledby="disputes-open-title">
            <div className={styles.ordersHeader}>
              <h2 className={`${styles.sectionTitle} ${styles.flush}`} id="disputes-open-title">
                Waiting for Carabao
              </h2>
            </div>
            {openRows.length === 0 ? (
              <p className={styles.emptyText}>No open disputes. Your delivered orders are clear.</p>
            ) : (
              <div className={styles.ordersList}>{openRows.map(card)}</div>
            )}
          </section>

          {decidedRows.length > 0 && (
            <section className={`${styles.panel} ${styles.listPanel}`} aria-labelledby="disputes-decided-title">
              <div className={styles.ordersHeader}>
                <h2 className={`${styles.sectionTitle} ${styles.flush}`} id="disputes-decided-title">
                  Decided
                </h2>
              </div>
              <div className={styles.ordersList}>{decidedRows.map(card)}</div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
