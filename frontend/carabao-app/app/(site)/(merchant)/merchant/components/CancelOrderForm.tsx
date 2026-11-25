import { useState } from "react";
import styles from "../page.module.css";
import s from "./orders.module.css";
import FieldError, { focusFirstInvalid, invalidClass, invalidProps, type FieldErrors } from "@/components/FieldError/FieldError";
import { MERCHANT_CANCEL_NOTE_MAX, WEB_CANCEL_REASONS, type MerchantCancelReason } from "@/util/api";
import getApiErrorMessage from "@/util/errorHelper";

type Props = {
  orderId: number;
  onSubmit: (reason: MerchantCancelReason, note: string) => Promise<void>;
  onClose: () => void;
};

/** Asks the farm why before cancelling; the buyer is sent the reason. */
export default function CancelOrderForm({ orderId, onSubmit, onClose }: Props) {
  const [reason, setReason] = useState<MerchantCancelReason | null>(null);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldErrors<"reason" | "note">>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reasonId = `cancel-reason-${orderId}`;
  const noteId = `cancel-note-${orderId}`;
  const noteRequired = reason === "other";

  const submit = async () => {
    const next: FieldErrors<"reason" | "note"> = {};
    if (!reason) next.reason = "Choose why you are cancelling.";
    if (noteRequired && !note.trim()) next.note = "Tell the buyer why you are cancelling.";
    setErrors(next);
    setFormError(null);
    if (next.reason || next.note || !reason) {
      requestAnimationFrame(focusFirstInvalid);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(reason, note);
    } catch (err) {
      setFormError(getApiErrorMessage(err, "The order could not be cancelled. Try again."));
      setSubmitting(false);
    }
  };

  return (
    <div className={s.cancelForm}>
      <p className={s.cancelIntro}>
        Cancelling refunds the buyer. We&apos;ll send them the reason you choose.
      </p>

      <fieldset className={`${s.cancelReasons}${invalidClass(errors.reason)}`} {...invalidProps(reasonId, errors.reason)}>
        <legend className={styles.formLabel}>Why are you cancelling?</legend>
        {WEB_CANCEL_REASONS.map((r) => (
          <label key={r.key} className={s.cancelReason}>
            <input
              type="radio"
              name={reasonId}
              value={r.key}
              checked={reason === r.key}
              disabled={submitting}
              onChange={() => {
                setReason(r.key);
                setErrors((e) => ({ ...e, reason: undefined, note: undefined }));
              }}
            />
            {r.label}
          </label>
        ))}
        <FieldError id={reasonId} message={errors.reason} />
      </fieldset>

      <label className={`${styles.formLabel}${invalidClass(errors.note)}`}>
        {noteRequired ? "Message to the buyer" : "Message to the buyer (optional)"}
        <textarea
          className={styles.formInput}
          rows={2}
          maxLength={MERCHANT_CANCEL_NOTE_MAX}
          value={note}
          disabled={submitting}
          placeholder={noteRequired ? "What happened?" : "Anything else they should know"}
          onChange={(e) => {
            setNote(e.target.value);
            if (errors.note) setErrors((x) => ({ ...x, note: undefined }));
          }}
          {...invalidProps(noteId, errors.note)}
        />
        <FieldError id={noteId} message={errors.note} />
      </label>

      <div className={styles.dangerActions}>
        <button type="button" className={styles.dangerConfirmBtn} disabled={submitting} onClick={() => void submit()}>
          {submitting ? "Cancelling…" : "Cancel order and notify buyer"}
        </button>
        <button type="button" className={styles.secondaryBtn} disabled={submitting} onClick={onClose}>
          Keep order
        </button>
      </div>
      {formError && <p role="alert" className={styles.errorText}>{formError}</p>}
    </div>
  );
}
