"use client";

import { useEffect, useState, type FormEvent } from "react";
import styles from "../page.module.css";
import { formatDate } from "../lib/format";
import getApiErrorMessage from "@/util/errorHelper";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { fmt } from "@/lib/i18n/format";
import {
  createMyVoucher,
  deleteMyVoucher,
  fetchMyVouchers,
  updateMyVoucher,
  type Voucher,
} from "@/util/api/vouchers";
import { EMPTY_DRAFT, describeVoucher, draftToInput, voucherStatus, type VoucherDraft } from "@/lib/vouchers";

// expires_at is the first moment the code stops working; show the day before.
const lastDay = (expiresAt: string) => new Date(Date.parse(expiresAt) - 1).toISOString();

/** CF-0061: the farm's voucher codes. The farm pays for each discount. */
export default function VouchersTab() {
  const { t } = useLanguage();
  const [vouchers, setVouchers] = useState<Voucher[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<VoucherDraft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    fetchMyVouchers()
      .then((list) => {
        if (!live) return;
        setVouchers(list);
        setLoadError(null);
      })
      .catch((err) => live && setLoadError(getApiErrorMessage(err) ?? "Could not load your vouchers."));
    return () => {
      live = false;
    };
  }, [reload]);

  const set = (field: keyof VoucherDraft) => (value: string) => setDraft((d) => ({ ...d, [field]: value }));

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const result = draftToInput(draft);
    if ("error" in result) {
      setFormError(result.error);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const made = await createMyVoucher(result.input);
      setVouchers((list) => [made, ...(list ?? [])]);
      setDraft(EMPTY_DRAFT);
    } catch (err) {
      setFormError(getApiErrorMessage(err) ?? "Could not create the voucher.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (v: Voucher) => {
    setRowError(null);
    try {
      const updated = await updateMyVoucher(v.id, { active: !v.active });
      setVouchers((list) => (list ?? []).map((x) => (x.id === v.id ? updated : x)));
    } catch (err) {
      setRowError(getApiErrorMessage(err) ?? "Could not change the voucher.");
    }
  };

  const remove = async (v: Voucher) => {
    if (!window.confirm(fmt(t.merchantConfirm.deleteVoucher, { code: v.code }))) return;
    setRowError(null);
    try {
      await deleteMyVoucher(v.id);
      setVouchers((list) => (list ?? []).filter((x) => x.id !== v.id));
    } catch (err) {
      setRowError(getApiErrorMessage(err) ?? "Could not delete the voucher.");
    }
  };

  const field = (id: keyof VoucherDraft, label: string, props: Record<string, unknown> = {}) => (
    <label htmlFor={`voucher-${id}`} style={{ display: "grid", gap: "0.25rem" }}>
      <span>{label}</span>
      <input
        id={`voucher-${id}`}
        value={draft[id]}
        onChange={(e) => set(id)(e.target.value)}
        {...props}
      />
    </label>
  );

  return (
    <>
      <section className={styles.panel} aria-labelledby="voucher-new-title">
        <h2 className={styles.panelTitle} id="voucher-new-title">New voucher</h2>
        <p className={styles.kpiSub}>
          Buyers enter the code at checkout. The discount comes off your produce subtotal (not the
          delivery fee), and your payout is the lower total.
        </p>
        <form
          onSubmit={create}
          style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fill, minmax(11rem, 1fr))" }}
        >
          {field("code", "Code", { maxLength: 32, autoCapitalize: "characters", required: true })}
          <label htmlFor="voucher-kind" style={{ display: "grid", gap: "0.25rem" }}>
            <span>Type</span>
            <select id="voucher-kind" value={draft.kind} onChange={(e) => set("kind")(e.target.value)}>
              <option value="percent">Percent off</option>
              <option value="fixed">Pesos off</option>
            </select>
          </label>
          {field("value", draft.kind === "percent" ? "Percent (1–90)" : "Pesos off", { inputMode: "numeric", required: true })}
          {draft.kind === "percent" && field("maxDiscount", "Up to ₱ (optional)", { inputMode: "numeric" })}
          {field("minSubtotal", "Minimum spend ₱ (optional)", { inputMode: "numeric" })}
          {field("usageLimit", "Total uses (optional)", { inputMode: "numeric" })}
          {field("perUserLimit", "Uses per buyer", { inputMode: "numeric" })}
          {field("startsOn", "First day (optional)", { type: "date" })}
          {field("endsOn", "Last day (optional)", { type: "date" })}
          <div style={{ alignSelf: "end" }}>
            <button type="submit" className={styles.primaryBtn} disabled={busy}>
              {busy ? "Saving…" : "Create voucher"}
            </button>
          </div>
        </form>
        {formError && <p className={styles.danger} role="alert">{formError}</p>}
      </section>

      <section className={styles.panel} aria-labelledby="voucher-list-title">
        <h2 className={styles.panelTitle} id="voucher-list-title">Your vouchers</h2>
        {loadError ? (
          <p className={styles.danger} role="alert">
            {loadError}{" "}
            <button type="button" className={styles.secondaryBtn} onClick={() => setReload((n) => n + 1)}>
              Try again
            </button>
          </p>
        ) : vouchers == null ? (
          <p className={styles.kpiSub}>Loading…</p>
        ) : vouchers.length === 0 ? (
          <p className={styles.emptyText}>No vouchers yet. Create one above.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th scope="col" align="left">Code</th>
                  <th scope="col" align="left">Discount</th>
                  <th scope="col" align="left">Uses</th>
                  <th scope="col" align="left">Dates</th>
                  <th scope="col" align="left">Status</th>
                  <th scope="col" align="left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {vouchers.map((v) => (
                  <tr key={v.id}>
                    <td><strong>{v.code}</strong></td>
                    <td>{describeVoucher(v)}</td>
                    <td>
                      {v.uses}
                      {v.usage_limit != null ? ` / ${v.usage_limit}` : ""}
                      {v.per_user_limit > 1 ? ` (${v.per_user_limit} per buyer)` : ""}
                    </td>
                    <td>
                      {v.starts_at ? `from ${formatDate(v.starts_at)}` : ""}
                      {v.starts_at && v.expires_at ? " " : ""}
                      {v.expires_at ? `until ${formatDate(lastDay(v.expires_at))}` : ""}
                      {!v.starts_at && !v.expires_at ? "No end date" : ""}
                    </td>
                    <td>{voucherStatus(v)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button type="button" className={styles.secondaryBtn} onClick={() => toggle(v)}>
                        {v.active ? "Turn off" : "Turn on"}
                      </button>{" "}
                      {v.uses === 0 && (
                        <button type="button" className={styles.dangerBtn} onClick={() => remove(v)}>
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rowError && <p className={styles.danger} role="alert">{rowError}</p>}
      </section>
    </>
  );
}
