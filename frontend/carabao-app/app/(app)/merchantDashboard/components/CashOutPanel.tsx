import { useState, type FormEvent } from "react";
import styles from "../page.module.css";
import {
  PAYOUT_STATUS_LABELS,
  requestPayout,
  updateMyPayoutInfo,
  type MerchantPayoutBatch,
  type PayoutInfo,
  type PayoutType,
} from "@/util/api";
import { getApiErrorStatus } from "@/util/errorHelper";
import { formatDate, formatPeso, type StatusMessage } from "../lib/format";

type PayoutDraft = {
  payout_type: PayoutType;
  bank_code: string;
  account_number: string;
  account_name: string;
  ewallet_number: string;
};

const draftFrom = (info: PayoutInfo | null): PayoutDraft => ({
  payout_type: info?.payout_type ?? "gcash",
  bank_code: info?.bank_code ?? "",
  account_number: info?.account_number ?? "",
  account_name: info?.account_name ?? "",
  ewallet_number: info?.ewallet_number ?? "",
});

type Props = {
  payoutInfo: PayoutInfo | null;
  onPayoutInfoSaved: (info: PayoutInfo) => void;
  available: number;
  pendingBatch: MerchantPayoutBatch | null;
  onPayoutRequested: (batch: MerchantPayoutBatch) => void;
  onMessage: (message: StatusMessage | null) => void;
};

export default function CashOutPanel({ payoutInfo, onPayoutInfoSaved, available, pendingBatch, onPayoutRequested, onMessage }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PayoutDraft>(() => draftFrom(null));
  const [saving, setSaving] = useState(false);
  const [requesting, setRequesting] = useState(false);

  const startEditing = () => { setDraft(draftFrom(payoutInfo)); setEditing(true); };
  const field = (key: keyof PayoutDraft) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: e.target.value })),
  });

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await updateMyPayoutInfo({
        payout_type: draft.payout_type,
        bank_code: draft.bank_code || null,
        account_number: draft.account_number || null,
        account_name: draft.account_name || null,
        ewallet_number: draft.ewallet_number || null,
      });
      onPayoutInfoSaved(updated);
      setEditing(false);
    } catch (err) {
      // 422: the backend rejects incomplete payout details instead of saving them.
      const incomplete = getApiErrorStatus(err) === 422;
      onMessage({
        type: "error",
        text: !incomplete
          ? "Could not save payout details. Please try again."
          : draft.payout_type === "bank"
            ? "Bank payouts need a bank, account number and account name."
            : "Enter the mobile number for your e-wallet.",
      });
    }
    finally { setSaving(false); }
  };

  const handleRequestPayout = async () => {
    setRequesting(true);
    onMessage(null);
    try {
      const batch = await requestPayout();
      onPayoutRequested(batch);
      onMessage({ type: "success", text: `Cash out request submitted for ${formatPeso(batch.gross_amount)}. Admin will process it shortly.` });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      onMessage({ type: "error", text: err?.response?.data?.detail ?? "Could not submit cash out request." });
    } finally {
      setRequesting(false);
    }
  };

  const renderBody = () => {
    if (pendingBatch) {
      return (
        <div className={styles.pendingPayout}>
          <p className={styles.pendingPayoutText}>
            You have a <strong>{PAYOUT_STATUS_LABELS[pendingBatch.status].toLowerCase()}</strong> payout request for{" "}
            <strong>{formatPeso(pendingBatch.gross_amount)}</strong> submitted on{" "}
            {formatDate(pendingBatch.created_at)}. Admin will process it shortly.
          </p>
        </div>
      );
    }

    if (editing) {
      const isBank = draft.payout_type === "bank";
      return (
        <form onSubmit={(e) => void handleSave(e)} className={styles.payoutForm}>
          <label className={styles.formLabel}>
            Payout Method
            <select className={styles.formInput} {...field("payout_type")}>
              <option value="gcash">GCash</option>
              <option value="maya">Maya</option>
              <option value="bank">Bank Transfer</option>
            </select>
          </label>
          {isBank && (
            <label className={`${styles.formLabel} ${styles.spaceAbove}`}>
              Bank Code
              <input className={styles.formInput} {...field("bank_code")} placeholder="BDO, BPI, UnionBank…" />
            </label>
          )}
          <label className={`${styles.formLabel} ${styles.spaceAbove}`}>
            Account Name
            <input className={styles.formInput} {...field("account_name")} placeholder="Full name on account" />
          </label>
          {isBank ? (
            <label className={`${styles.formLabel} ${styles.spaceAbove}`}>
              Account Number
              <input className={styles.formInput} {...field("account_number")} placeholder="Account number" />
            </label>
          ) : (
            <label className={`${styles.formLabel} ${styles.spaceAbove}`}>
              Mobile Number
              <input className={styles.formInput} {...field("ewallet_number")} placeholder="+63 9XX XXX XXXX" />
            </label>
          )}
          <div className={`${styles.formActions} ${styles.spaceAboveLg}`}>
            <button type="submit" className={styles.primaryBtn} disabled={saving}>{saving ? "Saving…" : "Save Payout Method"}</button>
            <button type="button" className={styles.secondaryBtn} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      );
    }

    if (!payoutInfo) {
      return (
        <div>
          <p className={`${styles.emptyText} ${styles.spaceBelow}`}>Set up your payout method to request a cash out.</p>
          <button className={styles.primaryBtn} onClick={startEditing}>Set Up Payout Method</button>
        </div>
      );
    }

    const infoRows: [string, string | null | undefined][] = [
      ["Account Name", payoutInfo.account_name],
      ["Bank", payoutInfo.bank_code],
      ["Account No.", payoutInfo.account_number],
      ["Mobile", payoutInfo.ewallet_number],
    ];

    return (
      <div>
        <div className={styles.payoutInfoCard}>
          <div className={styles.payoutInfoRow}>
            <span className={styles.payoutInfoLabel}>Method</span>
            <span className={styles.payoutInfoValue}>{payoutInfo.payout_type.toUpperCase()}</span>
          </div>
          {infoRows.filter(([, value]) => value).map(([label, value]) => (
            <div key={label} className={styles.payoutInfoRow}>
              <span className={styles.payoutInfoLabel}>{label}</span>
              <span className={styles.payoutInfoValue}>{value}</span>
            </div>
          ))}
        </div>
        <div className={`${styles.formActions} ${styles.spaceAboveLg}`}>
          <button
            className={styles.cashOutBtn}
            disabled={requesting || available === 0}
            onClick={() => void handleRequestPayout()}
          >
            {requesting ? "Submitting…" : `Cash Out ${formatPeso(available)}`}
          </button>
          <button className={styles.secondaryBtn} onClick={startEditing}>Edit Method</button>
        </div>
      </div>
    );
  };

  return (
    <div className={`${styles.panel} ${styles.grow1}`}>
      <h2 className={styles.panelTitle}>Cash Out</h2>
      {renderBody()}
    </div>
  );
}
