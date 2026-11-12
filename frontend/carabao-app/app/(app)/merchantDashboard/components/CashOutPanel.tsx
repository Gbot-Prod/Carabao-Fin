import { useEffect, useState, type FormEvent } from "react";
import styles from "../page.module.css";
import {
  PAYOUT_PROVIDER_LABELS,
  PAYOUT_PROVIDER_TIMING,
  fetchPayoutInstitutions,
  requestPayout,
  updateMyPayoutInfo,
  type AvailablePayout,
  type MerchantPayoutBatch,
  type PayoutInfo,
  type PayoutInstitution,
  type PayoutType,
} from "@/util/api";
import { getApiErrorStatus } from "@/util/errorHelper";
import { formatDate, formatPeso, type StatusMessage } from "../lib/format";

export const PAYOUT_METHOD_LABELS: Record<PayoutType, string> = {
  gcash: "GCash",
  maya: "Maya",
  bank: "Bank Transfer",
};

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
  available: AvailablePayout | null;
  /** A requested or in-flight payout; blocks a new cash out. */
  openBatch: MerchantPayoutBatch | null;
  /** The latest payout, when PayMongo could not deliver it. */
  failedBatch: MerchantPayoutBatch | null;
  onPayoutRequested: (batch: MerchantPayoutBatch) => void;
  onMessage: (message: StatusMessage | null) => void;
};

export default function CashOutPanel({
  payoutInfo,
  onPayoutInfoSaved,
  available,
  openBatch,
  failedBatch,
  onPayoutRequested,
  onMessage,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PayoutDraft>(() => draftFrom(null));
  const [saving, setSaving] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [banks, setBanks] = useState<PayoutInstitution[] | null>(null);
  const [banksError, setBanksError] = useState(false);

  const needsBanks = editing && draft.payout_type === "bank" && banks === null && !banksError;
  useEffect(() => {
    if (!needsBanks) return;
    fetchPayoutInstitutions()
      .then(setBanks)
      .catch(() => setBanksError(true));
  }, [needsBanks]);

  const startEditing = () => {
    setDraft(draftFrom(payoutInfo));
    setBanksError(false);
    setEditing(true);
  };
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
      onMessage(null);
      setEditing(false);
    } catch (err) {
      // 422: the backend rejects incomplete payout details instead of saving them.
      const status = getApiErrorStatus(err);
      onMessage({
        type: "error",
        text:
          status === 422
            ? draft.payout_type === "bank"
              ? "Pick your bank and enter the account number and account holder's name."
              : "Enter the account holder's name and a mobile number like 09171234567."
            : status === 502
              ? "Could not reach PayMongo to check the bank. Please try again."
              : "Could not save payout details. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRequestPayout = async () => {
    setRequesting(true);
    onMessage(null);
    try {
      const batch = await requestPayout();
      onPayoutRequested(batch);
      onMessage({
        type: "success",
        text: `Cash out requested. You'll receive ${formatPeso(batch.net_amount ?? batch.gross_amount)} once the admin sends it.`,
      });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      onMessage({ type: "error", text: err?.response?.data?.detail ?? "Could not submit cash out request." });
    } finally {
      setRequesting(false);
    }
  };

  const destinationText = (batch: MerchantPayoutBatch) =>
    batch.destination_type
      ? `${PAYOUT_METHOD_LABELS[batch.destination_type]} ${batch.destination_number ?? ""}`.trim()
      : "your payout account";

  const renderOpenBatch = (batch: MerchantPayoutBatch) => {
    const net = batch.net_amount ?? batch.gross_amount;
    return (
      <div className={styles.pendingPayout}>
        <p className={styles.pendingPayoutText}>
          {batch.status === "processing" ? (
            <>
              Sending <strong>{formatPeso(net)}</strong> to {destinationText(batch)}
              {batch.transfer_provider &&
                ` via ${PAYOUT_PROVIDER_LABELS[batch.transfer_provider]}. It ${PAYOUT_PROVIDER_TIMING[batch.transfer_provider]}`}
              .
            </>
          ) : (
            <>
              You requested <strong>{formatPeso(net)}</strong> on {formatDate(batch.created_at)} (
              {formatPeso(batch.gross_amount)} earned minus the {formatPeso(batch.transfer_fee ?? 0)} transfer fee).
              The admin will send it shortly.
            </>
          )}
        </p>
      </div>
    );
  };

  const renderForm = () => {
    const isBank = draft.payout_type === "bank";
    const currentBankMissing =
      isBank && banks !== null && draft.bank_code !== "" && !banks.some((b) => b.code === draft.bank_code);
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
            Bank
            {banksError ? (
              <span className={styles.payoutFieldError}>
                Could not load the bank list.{" "}
                <button type="button" className={styles.linkBtn} onClick={() => setBanksError(false)}>
                  Try again
                </button>
              </span>
            ) : (
              <select className={styles.formInput} {...field("bank_code")} disabled={banks === null} required>
                <option value="">{banks === null ? "Loading banks…" : "Select your bank"}</option>
                {currentBankMissing && <option value={draft.bank_code}>{draft.bank_code} (pick again)</option>}
                {banks?.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
            {draft.bank_code && !currentBankMissing && (
              <span className={styles.payoutFieldHint}>Bank code: {draft.bank_code}</span>
            )}
          </label>
        )}
        {isBank && (
          <div className={`${styles.payoutDisclaimer} ${styles.spaceAbove}`}>
            <strong>What PayMongo needs for a bank payout</strong>
            <ul>
              <li>
                <strong>Bank code:</strong> your bank&apos;s 11-character InstaPay/SWIFT code (BIC), e.g.{" "}
                <code>BNORPHMMXXX</code> for BDO. Picking your bank above fills it in; only banks on PayMongo&apos;s
                InstaPay list appear.
              </li>
              <li>
                <strong>Account number:</strong> exactly as on your passbook or bank app, digits only, no spaces or
                dashes. Use a savings or checking account, not a card number.
              </li>
              <li>
                <strong>Account holder name:</strong> the full name registered with the bank.
              </li>
            </ul>
            A wrong code or number makes the transfer fail and delays your payout until it&apos;s corrected.
          </div>
        )}
        <label className={`${styles.formLabel} ${styles.spaceAbove}`}>
          Account Holder Name
          <input
            className={styles.formInput}
            {...field("account_name")}
            placeholder={isBank ? "Name on the bank account" : `Name on the ${PAYOUT_METHOD_LABELS[draft.payout_type]} account`}
            required
          />
        </label>
        {isBank ? (
          <label className={`${styles.formLabel} ${styles.spaceAbove}`}>
            Account Number
            <input
              className={styles.formInput}
              {...field("account_number")}
              placeholder="Digits only, e.g. 001234567890"
              inputMode="numeric"
              pattern="[0-9]{6,20}"
              title="Digits only, no spaces or dashes"
              required
            />
          </label>
        ) : (
          <label className={`${styles.formLabel} ${styles.spaceAbove}`}>
            {PAYOUT_METHOD_LABELS[draft.payout_type]} Mobile Number
            <input
              className={styles.formInput}
              {...field("ewallet_number")}
              placeholder="09171234567"
              inputMode="tel"
              required
            />
          </label>
        )}
        {draft.payout_type === "gcash" && (
          <p className={`${styles.payoutFeeLine} ${styles.spaceAbove}`}>
            GCash payouts go through PESONet, so they arrive on banking-day cycles instead of within minutes.
          </p>
        )}
        <div className={`${styles.formActions} ${styles.spaceAboveLg}`}>
          <button type="submit" className={styles.primaryBtn} disabled={saving}>
            {saving ? "Saving…" : "Save Payout Method"}
          </button>
          <button type="button" className={styles.secondaryBtn} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </form>
    );
  };

  const renderMethod = (info: PayoutInfo) => {
    const infoRows: [string, string | null | undefined][] = [
      ["Account Name", info.account_name],
      ["Bank", info.bank_name ?? info.bank_code],
      ["Account No.", info.account_number],
      ["Mobile", info.ewallet_number],
    ];
    const gross = available?.gross_amount ?? 0;
    const fee = available?.transfer_fee ?? 0;
    const net = available?.net_amount ?? 0;
    const canCashOut = !openBatch && !info.problem && gross > fee;

    return (
      <div>
        <div className={styles.payoutInfoCard}>
          <div className={styles.payoutInfoRow}>
            <span className={styles.payoutInfoLabel}>Method</span>
            <span className={styles.payoutInfoValue}>{PAYOUT_METHOD_LABELS[info.payout_type]}</span>
          </div>
          {infoRows
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label} className={styles.payoutInfoRow}>
                <span className={styles.payoutInfoLabel}>{label}</span>
                <span className={styles.payoutInfoValue}>{value}</span>
              </div>
            ))}
        </div>

        {info.problem && (
          <p className={`${styles.payoutNotice} ${styles.payoutNoticeError} ${styles.spaceAbove}`}>
            Update your payout method before cashing out: {info.problem}
          </p>
        )}

        {!openBatch && gross > 0 && (
          <p className={`${styles.payoutFeeLine} ${styles.spaceAbove}`}>
            {formatPeso(gross)} earned − {formatPeso(fee)} transfer fee = <strong>{formatPeso(net)}</strong> to you
          </p>
        )}

        <div className={`${styles.formActions} ${styles.spaceAboveLg}`}>
          {!openBatch && (
            <button
              className={styles.cashOutBtn}
              disabled={requesting || !canCashOut}
              onClick={() => void handleRequestPayout()}
            >
              {requesting ? "Submitting…" : `Cash Out ${formatPeso(net)}`}
            </button>
          )}
          <button className={styles.secondaryBtn} onClick={startEditing}>
            Edit Method
          </button>
        </div>
        {!openBatch && gross > 0 && gross <= fee && (
          <p className={`${styles.payoutFeeLine} ${styles.spaceAbove}`}>
            Earn more than {formatPeso(fee)} to cover the transfer fee before cashing out.
          </p>
        )}
      </div>
    );
  };

  const renderBody = () => {
    if (editing) return renderForm();
    if (!payoutInfo) {
      return (
        <div>
          <p className={`${styles.emptyText} ${styles.spaceBelow}`}>Set up your payout method to request a cash out.</p>
          <button className={styles.primaryBtn} onClick={startEditing}>
            Set Up Payout Method
          </button>
        </div>
      );
    }
    return renderMethod(payoutInfo);
  };

  return (
    <div className={`${styles.panel} ${styles.grow1}`}>
      <h2 className={styles.panelTitle}>Cash Out</h2>
      {failedBatch && !editing && (
        <p className={`${styles.payoutNotice} ${styles.payoutNoticeError} ${styles.spaceBelow}`}>
          Your {formatPeso(failedBatch.net_amount ?? failedBatch.gross_amount)} payout could not be sent
          {failedBatch.failure_reason ? ` (${failedBatch.failure_reason})` : ""}. Check your payout method below; the
          admin will send it again.
        </p>
      )}
      {openBatch && !editing && <div className={styles.spaceBelow}>{renderOpenBatch(openBatch)}</div>}
      {renderBody()}
    </div>
  );
}
