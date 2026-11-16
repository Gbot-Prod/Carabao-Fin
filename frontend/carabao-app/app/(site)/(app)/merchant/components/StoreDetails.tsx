import { useEffect, useState } from "react";
import styles from "../page.module.css";
import LocationSelects from "@/components/LocationSelects/LocationSelects";
import MapPinPicker from "@/components/MapPinPicker/MapPinPicker";
import { sendOtp, updateMyMerchant, verifyOtp, type Merchant } from "@/util/api";
import errorHelper from "@/util/errorHelper";
import { normalizePhMobile } from "@/lib/phone";
import { formatLocalPhone } from "../lib/format";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
// Same limit as the backend (MerchantUpdate.delivery_price).
const MAX_DELIVERY_PRICE = 100_000;

type LocationDraft = {
  region: string;
  province: string;
  barangay: string;
  city: string;
  address: string;
  postal_code: string;
  contact_number: string;
  available_days: string[];
  delivery_price: string;
  // Farm pickup point (U1c).
  lat: number | null;
  lng: number | null;
};

const draftFromMerchant = (merchant: Merchant | null): LocationDraft => ({
  region: merchant?.region ?? "",
  province: merchant?.province ?? "",
  city: merchant?.city ?? "",
  barangay: merchant?.barangay ?? "",
  address: merchant?.address ?? "",
  postal_code: merchant?.postal_code ?? "",
  lat: merchant?.lat ?? null,
  lng: merchant?.lng ?? null,
  contact_number: formatLocalPhone((merchant?.contact_number ?? "").replace(/^\+?63\s?/, "")),
  available_days: DAYS.filter((d) => merchant?.available_days?.includes(d)),
  delivery_price: merchant?.delivery_price != null ? String(merchant.delivery_price) : "",
});

const daysText = (merchant: Merchant | null) =>
  DAYS.filter((d) => merchant?.available_days?.includes(d)).join(", ");

type Props = {
  merchant: Merchant | null;
  onSaved: (merchant: Merchant) => void;
};

export default function StoreDetails({ merchant, onSaved }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<LocationDraft>(() => draftFromMerchant(null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // CF-0030: a new contact number is saved only with a code sent to it.
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  // The code is used up once checked; keep its token in case the save fails.
  const [verified, setVerified] = useState<{ number: string; token: string } | null>(null);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const newNumber = normalizePhMobile(draft.contact_number);
  const numberChanged =
    draft.contact_number.trim() !== "" &&
    newNumber !== normalizePhMobile(merchant?.contact_number ?? "");

  const toggleDay = (day: typeof DAYS[number]) =>
    setDraft((prev) => {
      const set = new Set(prev.available_days);
      if (set.has(day)) set.delete(day); else set.add(day);
      return { ...prev, available_days: DAYS.filter((x) => set.has(x)) };
    });

  const startEditing = () => {
    setDraft(draftFromMerchant(merchant));
    setError(null);
    setCodeSentTo(null);
    setCode("");
    setVerified(null);
    setEditing(true);
  };

  const handleSendCode = async () => {
    setError(null);
    if (!newNumber) {
      setError("Enter a Philippine mobile number, e.g. 912 345 6789.");
      return;
    }
    setSendingCode(true);
    try {
      await sendOtp(newNumber);
      setCodeSentTo(newNumber);
      setCode("");
      setResendCooldown(60);
    } catch (err: unknown) {
      setError(errorHelper(err) || "The code could not be sent. Try again.");
    } finally {
      setSendingCode(false);
    }
  };

  const handleSave = async () => {
    setError(null);
    if (draft.available_days.length === 0) {
      setError("Select at least one operating day.");
      return;
    }
    const fee = draft.delivery_price.trim() === "" ? null : Number(draft.delivery_price);
    if (fee !== null && (!Number.isInteger(fee) || fee < 0 || fee > MAX_DELIVERY_PRICE)) {
      setError(`Enter a delivery fee from ₱0 to ₱${MAX_DELIVERY_PRICE.toLocaleString()}, in whole pesos.`);
      return;
    }
    if (numberChanged && !newNumber) {
      setError("Enter a Philippine mobile number, e.g. 912 345 6789.");
      return;
    }
    const haveToken = verified?.number === newNumber;
    if (numberChanged && !haveToken && (codeSentTo !== newNumber || code.length !== 6)) {
      setError("Send a code to the new contact number and enter it first.");
      return;
    }
    setSaving(true);
    try {
      let token: string | null = null;
      if (numberChanged && newNumber) {
        token = haveToken && verified ? verified.token : await verifyOtp(newNumber, code);
        setVerified({ number: newNumber, token });
      }
      const updated = await updateMyMerchant({
        region: draft.region.trim() || undefined,
        province: draft.province.trim() || undefined,
        city: draft.city.trim() || null,
        barangay: draft.barangay.trim() || null,
        address: draft.address.trim() || undefined,
        postal_code: draft.postal_code.trim() || undefined,
        lat: draft.lat,
        lng: draft.lng,
        ...(numberChanged && newNumber ? { contact_number: newNumber, phone_verification_token: token } : {}),
        available_days: draft.available_days,
        delivery_price: fee,
      });
      onSaved(updated);
      setEditing(false);
    } catch (err: unknown) {
      setError(errorHelper(err) || "The store details could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const detailRows: [string, string | null | undefined][] = [
    ["Region", merchant?.region],
    ["Province", merchant?.province],
    ["City", merchant?.city],
    ["Barangay", merchant?.barangay],
    ["Address", merchant?.address],
    ["Map pin", merchant?.lat != null && merchant?.lng != null ? `${merchant.lat.toFixed(5)}, ${merchant.lng.toFixed(5)}` : "Not pinned"],
    ["Contact", merchant?.contact_number],
    ["Open", daysText(merchant) || null],
    ["Delivery fee", merchant?.delivery_price != null ? `₱${merchant.delivery_price.toLocaleString()} per order` : null],
  ];

  return (
    <div className={styles.shopDetailsSection}>
      <h3 className={styles.shopDetailsSectionTitle}>Store Details</h3>
      {editing ? (
        <div className={styles.shopDetailsForm}>
          <label className={styles.formLabel}>
            Street / House No.
            <input
              className={styles.formInput}
              value={draft.address}
              onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))}
              placeholder="e.g. 123 Rizal St., Unit 4B"
              maxLength={500}
            />
          </label>

          <div className={styles.shopDetailsLocRow}>
            <LocationSelects
              value={{ region: draft.region, province: draft.province, city: draft.city, barangay: draft.barangay }}
              onChange={(location) => setDraft((prev) => ({ ...prev, ...location }))}
              selectClassName={styles.formInput}
              labelClassName={styles.formLabel}
              wrapClassName={styles.panelFormField}
            />
          </div>

          <div className={styles.formLabel}>
            <span>Contact Number</span>
            <div className={styles.phoneRow}>
              <span className={styles.phonePrefix}>+63</span>
              <input
                className={styles.phoneInput}
                aria-label="Contact number (+63)"
                value={draft.contact_number}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, contact_number: formatLocalPhone(e.target.value) }));
                  setCodeSentTo(null);
                  setCode("");
                }}
                placeholder="912 345 6789"
                inputMode="numeric"
                maxLength={12}
                disabled={saving}
              />
            </div>
            {numberChanged && (
              <>
                <p className={styles.payoutFieldHint}>
                  We send a code to the new number. You must enter it before you can save.
                </p>
                {codeSentTo === newNumber && (
                  <input
                    className={styles.formInput}
                    aria-label="6-digit code sent to the new contact number"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="6-digit code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    autoComplete="one-time-code"
                  />
                )}
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  disabled={sendingCode || saving || (codeSentTo === newNumber && resendCooldown > 0)}
                  onClick={() => void handleSendCode()}
                >
                  {sendingCode
                    ? "Sending…"
                    : codeSentTo === newNumber
                      ? resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : "Resend code"
                      : "Send code"}
                </button>
              </>
            )}
          </div>

          <label className={styles.formLabel}>
            Postal Code
            <input
              className={styles.formInput}
              value={draft.postal_code}
              onChange={(e) => setDraft((d) => ({ ...d, postal_code: e.target.value }))}
              placeholder="e.g. 2600"
              maxLength={10}
            />
          </label>

          <label className={styles.formLabel}>
            Delivery fee per order (₱)
            <input
              className={styles.formInput}
              value={draft.delivery_price}
              onChange={(e) => setDraft((d) => ({ ...d, delivery_price: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
              placeholder="e.g. 80"
              inputMode="numeric"
            />
          </label>

          <div className={`${styles.formLabel} ${styles.formLabelLoose}`}>
            <MapPinPicker
              value={draft.lat != null && draft.lng != null ? { lat: draft.lat, lng: draft.lng } : null}
              onChange={(pin, found) =>
                setDraft((d) => ({
                  ...d,
                  lat: pin.lat,
                  lng: pin.lng,
                  address: d.address || found?.street || d.address,
                  postal_code: d.postal_code || found?.postcode || d.postal_code,
                }))
              }
            />
          </div>

          <div className={`${styles.formLabel} ${styles.formLabelLoose}`}>
            <span>Operating Days</span>
            <div className={styles.tickRow}>
              {DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`${styles.tickBtn} ${draft.available_days.includes(d) ? styles.tickBtnActive : ""}`}
                  onClick={() => toggleDay(d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {error && <p className={styles.payoutFieldError} role="alert">{error}</p>}

          <div className={`${styles.formActions} ${styles.spaceAboveLg}`}>
            <button className={styles.primaryBtn} disabled={saving} onClick={() => void handleSave()}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className={styles.secondaryBtn} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className={styles.shopDetailsView}>
          {detailRows.map(([label, value]) => (
            <div key={label} className={styles.shopDetailRow}>
              <span className={styles.shopDetailLabel}>{label}</span>
              <span className={styles.shopDetailValue}>{value ?? <em>Not set</em>}</span>
            </div>
          ))}
          <button
            className={`${styles.uploadBtn} ${styles.spaceAboveLg}`}
            onClick={startEditing}
          >
            Edit store details
          </button>
        </div>
      )}
    </div>
  );
}
