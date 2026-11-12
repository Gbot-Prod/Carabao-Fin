import styles from "../page.module.css";
import type { PriceTier, Produce, ProduceCreatePayload } from "@/util/api";
import { todayInManila } from "../lib/format";
import ReferencePriceHint from "@/components/ReferencePrice/ReferencePriceHint";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { fmt } from "@/lib/i18n/format";

export type ProduceFormState = {
  name: string;
  description: string;
  category: "Vegetables" | "Fruits" | "";
  price: number;
  unit: "kg" | "lbs";
  unit_quantity: number;
  stock_quantity: number;
  image_url: string;
  harvest_date: string;
  best_before: string;
  min_order_qty: number;
  price_tiers: PriceTier[];
};

// Matches the server's limit.
const MAX_PRICE_TIERS = 5;

export const emptyProduceForm: ProduceFormState = {
  name: "", description: "", category: "", price: 0, unit: "kg", unit_quantity: 1, stock_quantity: 0, image_url: "",
  harvest_date: "", best_before: "", min_order_qty: 1, price_tiers: [],
};

export const produceToForm = (p: Produce): ProduceFormState => ({
  name: p.name ?? "",
  description: p.description ?? "",
  category: p.category ?? "",
  price: p.price,
  unit: p.unit ?? "kg",
  unit_quantity: p.unit_quantity ?? 1,
  stock_quantity: p.stock_quantity,
  image_url: p.image_url ?? "",
  harvest_date: p.harvest_date ?? "",
  best_before: p.best_before ?? "",
  min_order_qty: p.min_order_qty ?? 1,
  price_tiers: p.price_tiers ?? [],
});

export const formToPayload = (f: ProduceFormState): ProduceCreatePayload => ({
  name: f.name,
  description: f.description || null,
  category: f.category || null,
  price: f.price,
  unit: f.unit,
  unit_quantity: f.unit_quantity,
  stock_quantity: f.stock_quantity,
  image_url: f.image_url || null,
  harvest_date: f.harvest_date,
  best_before: f.best_before,
  min_order_qty: f.min_order_qty,
  price_tiers: f.price_tiers,
});

function TickGroup<T extends string>({
  label, options, value, onChange, optionLabels,
}: {
  label: string;
  options: readonly T[];
  value: T | "";
  onChange: (v: T) => void;
  /** Shown text per option; the stored value stays the option itself. */
  optionLabels?: Partial<Record<T, string>>;
}) {
  return (
    <div>
      <div className={styles.formTickLabel}>{label}</div>
      <div className={styles.tickRow}>
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            className={`${styles.tickBtn} ${value === opt ? styles.tickBtnActive : ""}`}
            onClick={() => onChange(opt)}
          >
            {optionLabels?.[opt] ?? opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function PriceTierFields({ form, onChange }: { form: ProduceFormState; onChange: (f: ProduceFormState) => void }) {
  const { t } = useLanguage();
  const setTier = (index: number, tier: PriceTier) =>
    onChange({ ...form, price_tiers: form.price_tiers.map((t, i) => (i === index ? tier : t)) });
  const addTier = () => {
    const last = form.price_tiers[form.price_tiers.length - 1];
    const minQty = Math.max(last ? last.min_qty + 1 : 0, form.min_order_qty + 1, 2);
    const unitPrice = Math.max((last ? last.unit_price : form.price) - 1, 1);
    onChange({ ...form, price_tiers: [...form.price_tiers, { min_qty: minQty, unit_price: unitPrice }] });
  };
  const removeTier = (index: number) =>
    onChange({ ...form, price_tiers: form.price_tiers.filter((_, i) => i !== index) });

  return (
    <div className={styles.tierSection}>
      <label className={styles.formLabel}>
        {t.listing.minOrder}
        <input
          className={styles.formInput}
          type="number"
          min="1"
          step="1"
          required
          value={form.min_order_qty}
          onChange={(e) => onChange({ ...form, min_order_qty: Math.max(1, Math.floor(Number(e.target.value)) || 1) })}
        />
      </label>

      <div className={styles.formTickLabel}>{t.listing.bulkPrices}</div>
      <p className={styles.tierHint}>{t.listing.tierHint}</p>
      {form.price_tiers.map((tier, index) => (
        <div key={index} className={styles.tierRow}>
          <span className={styles.pricePerLabel}>{t.listing.from}</span>
          <input
            className={styles.formInput}
            type="number"
            min={form.min_order_qty + 1}
            step="1"
            required
            aria-label={fmt(t.listing.tierQty, { n: index + 1 })}
            value={tier.min_qty}
            onChange={(e) => setTier(index, { ...tier, min_qty: Math.floor(Number(e.target.value)) || 0 })}
          />
          <span className={styles.pricePerLabel}>{t.listing.unitsPeso}</span>
          <input
            className={styles.formInput}
            type="number"
            min="1"
            step="1"
            required
            aria-label={fmt(t.listing.tierPrice, { n: index + 1 })}
            value={tier.unit_price}
            onChange={(e) => setTier(index, { ...tier, unit_price: Math.floor(Number(e.target.value)) || 0 })}
          />
          <span className={styles.pricePerLabel}>{t.listing.each}</span>
          <button type="button" className={styles.secondaryBtn} onClick={() => removeTier(index)}>
            {t.listing.removeTier}
          </button>
        </div>
      ))}
      {form.price_tiers.length < MAX_PRICE_TIERS && (
        <button type="button" className={styles.secondaryBtn} onClick={addTier}>
          {t.listing.addTier}
        </button>
      )}
    </div>
  );
}

export default function ProduceFormFields({ form, onChange }: { form: ProduceFormState; onChange: (f: ProduceFormState) => void }) {
  const { t } = useLanguage();
  return (
    <>
      <div className={styles.formGrid}>
        <label className={styles.formLabel}>
          {t.listing.name}
          <input className={styles.formInput} required value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} />
        </label>
        <label className={styles.formLabel}>
          {t.listing.stock}
          <input className={styles.formInput} type="number" min="0" value={form.stock_quantity} onChange={(e) => onChange({ ...form, stock_quantity: Number(e.target.value) })} />
        </label>
      </div>

      <div className={styles.formGrid}>
        <label className={styles.formLabel}>
          {t.listing.harvestDate}
          <input
            className={styles.formInput}
            type="date"
            required
            max={todayInManila()}
            value={form.harvest_date}
            onChange={(e) => onChange({ ...form, harvest_date: e.target.value })}
          />
        </label>
        <label className={styles.formLabel}>
          {t.listing.bestBefore}
          <input
            className={styles.formInput}
            type="date"
            required
            min={form.harvest_date || undefined}
            value={form.best_before}
            onChange={(e) => onChange({ ...form, best_before: e.target.value })}
          />
        </label>
      </div>

      <div className={styles.formTickRow}>
        <TickGroup
          label={t.listing.category}
          options={["Vegetables", "Fruits"] as const}
          optionLabels={{ Vegetables: t.listing.vegetables, Fruits: t.listing.fruits }}
          value={form.category}
          onChange={(v) => onChange({ ...form, category: v })}
        />
        <TickGroup
          label={t.listing.unit}
          options={["kg", "lbs"] as const}
          value={form.unit}
          onChange={(v) => onChange({ ...form, unit: v })}
        />
      </div>

      <div className={styles.priceRow}>
        <label className={`${styles.formLabel} ${styles.grow1}`}>
          {t.listing.price}
          <input className={styles.formInput} type="number" min="0" value={form.price} onChange={(e) => onChange({ ...form, price: Number(e.target.value) })} />
        </label>
        <div className={styles.pricePerLabel}>{t.listing.per}</div>
        <label className={`${styles.formLabel} ${styles.qtyField}`}>
          {t.listing.quantity}
          <input className={styles.formInput} type="number" min="0.1" step="0.1" value={form.unit_quantity ?? 1} onChange={(e) => onChange({ ...form, unit_quantity: Number(e.target.value) || 1 })} />
        </label>
        <div className={styles.priceUnitLabel}>{form.unit}</div>
      </div>

      {form.price > 0 && form.unit_quantity > 0 && (
        <div className={styles.pricePreview}>
          {fmt(t.listing.pricePreview, { price: form.price, qty: form.unit_quantity === 1 ? "" : form.unit_quantity, unit: form.unit })}
        </div>
      )}

      {/* Fair-price information (P1): the market range for what's being listed. */}
      <ReferencePriceHint
        name={form.name}
        unit={form.unit}
        price={form.unit_quantity > 0 ? form.price / form.unit_quantity : undefined}
      />

      <PriceTierFields form={form} onChange={onChange} />

      <label className={styles.formLabelFull}>
        {t.listing.description}
        <textarea className={styles.formInput} rows={2} value={form.description} onChange={(e) => onChange({ ...form, description: e.target.value })} />
      </label>
    </>
  );
}
