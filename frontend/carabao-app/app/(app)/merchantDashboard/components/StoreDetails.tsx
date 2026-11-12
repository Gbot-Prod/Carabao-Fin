import { useState } from "react";
import styles from "../page.module.css";
import LocationSelects from "@/components/LocationSelects/LocationSelects";
import MapPinPicker from "@/components/MapPinPicker/MapPinPicker";
import { updateMyMerchant, type Merchant } from "@/util/api";
import { formatLocalPhone } from "../lib/format";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

type LocationDraft = {
  region: string;
  province: string;
  barangay: string;
  city: string;
  address: string;
  postal_code: string;
  contact_number: string;
  available_days: string[];
  // Farm pickup point (U1c).
  lat: number | null;
  lng: number | null;
};

const operatingHoursText = (merchant: Merchant | null) => {
  const oh = merchant?.operating_hours;
  return oh ? (typeof oh === "string" ? oh : JSON.stringify(oh)) : "";
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
  contact_number: formatLocalPhone((merchant?.contact_number ?? "").replace(/^\+63\s?/, "")),
  available_days: operatingHoursText(merchant)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => DAYS.includes(s as typeof DAYS[number])),
});

type Props = {
  merchant: Merchant | null;
  onSaved: (merchant: Merchant) => void;
};

export default function StoreDetails({ merchant, onSaved }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<LocationDraft>(() => draftFromMerchant(null));
  const [saving, setSaving] = useState(false);

  const toggleDay = (day: typeof DAYS[number]) =>
    setDraft((prev) => {
      const set = new Set(prev.available_days);
      if (set.has(day)) set.delete(day); else set.add(day);
      return { ...prev, available_days: DAYS.filter((x) => set.has(x)) };
    });

  const handleSave = async () => {
    setSaving(true);
    try {
      const localDigits = draft.contact_number.replace(/\s/g, "");
      const updated = await updateMyMerchant({
        region: draft.region.trim() || undefined,
        province: draft.province.trim() || undefined,
        city: draft.city.trim() || null,
        barangay: draft.barangay.trim() || null,
        address: draft.address.trim() || undefined,
        postal_code: draft.postal_code.trim() || undefined,
        lat: draft.lat,
        lng: draft.lng,
        contact_number: localDigits ? `+63 ${formatLocalPhone(localDigits)}` : undefined,
        operating_hours: draft.available_days.length > 0 ? draft.available_days.join(", ") : null,
      });
      onSaved(updated);
      setEditing(false);
    } catch { /* silently fail */ }
    finally { setSaving(false); }
  };

  const detailRows: [string, string | null | undefined][] = [
    ["Region", merchant?.region],
    ["Province", merchant?.province],
    ["City", merchant?.city],
    ["Barangay", merchant?.barangay],
    ["Address", merchant?.address],
    ["Map pin", merchant?.lat != null && merchant?.lng != null ? `${merchant.lat.toFixed(5)}, ${merchant.lng.toFixed(5)}` : "Not pinned"],
    ["Contact", merchant?.contact_number],
    ["Open", operatingHoursText(merchant) || null],
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
                onChange={(e) => setDraft((d) => ({ ...d, contact_number: formatLocalPhone(e.target.value) }))}
                placeholder="912 345 6789"
                inputMode="numeric"
                maxLength={12}
              />
            </div>
          </div>

          <label className={styles.formLabel}>
            Postal Code
            <input
              className={styles.formInput}
              value={draft.postal_code}
              onChange={(e) => setDraft((d) => ({ ...d, postal_code: e.target.value }))}
              placeholder="e.g. 2600"
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
            onClick={() => { setDraft(draftFromMerchant(merchant)); setEditing(true); }}
          >
            Edit store details
          </button>
        </div>
      )}
    </div>
  );
}
