import styles from "../page.module.css";
import type { PriceTier, Produce, ProduceCreatePayload } from "@/util/api";
import { todayInManila } from "../lib/format";
import ReferencePriceHint from "@/components/ReferencePrice/ReferencePriceHint";

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
  label, options, value, onChange,
}: { label: string; options: readonly T[]; value: T | ""; onChange: (v: T) => void }) {
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
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function PriceTierFields({ form, onChange }: { form: ProduceFormState; onChange: (f: ProduceFormState) => void }) {
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
        Minimum order
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

      <div className={styles.formTickLabel}>Bulk prices</div>
      <p className={styles.tierHint}>
        Buyers pay the price of the highest tier their quantity reaches. Each tier must start above the
        minimum order and be cheaper than the one before.
      </p>
      {form.price_tiers.map((tier, index) => (
        <div key={index} className={styles.tierRow}>
          <span className={styles.pricePerLabel}>From</span>
          <input
            className={styles.formInput}
            type="number"
            min={form.min_order_qty + 1}
            step="1"
            required
            aria-label={`Tier ${index + 1} quantity`}
            value={tier.min_qty}
            onChange={(e) => setTier(index, { ...tier, min_qty: Math.floor(Number(e.target.value)) || 0 })}
          />
          <span className={styles.pricePerLabel}>units, ₱</span>
          <input
            className={styles.formInput}
            type="number"
            min="1"
            step="1"
            required
            aria-label={`Tier ${index + 1} price`}
            value={tier.unit_price}
            onChange={(e) => setTier(index, { ...tier, unit_price: Math.floor(Number(e.target.value)) || 0 })}
          />
          <span className={styles.pricePerLabel}>each</span>
          <button type="button" className={styles.secondaryBtn} onClick={() => removeTier(index)}>
            Remove
          </button>
        </div>
      ))}
      {form.price_tiers.length < MAX_PRICE_TIERS && (
        <button type="button" className={styles.secondaryBtn} onClick={addTier}>
          + Add bulk price
        </button>
      )}
    </div>
  );
}

export default function ProduceFormFields({ form, onChange }: { form: ProduceFormState; onChange: (f: ProduceFormState) => void }) {
  return (
    <>
      <div className={styles.formGrid}>
        <label className={styles.formLabel}>
          Name *
          <input className={styles.formInput} required value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} />
        </label>
        <label className={styles.formLabel}>
          Stock
          <input className={styles.formInput} type="number" min="0" value={form.stock_quantity} onChange={(e) => onChange({ ...form, stock_quantity: Number(e.target.value) })} />
        </label>
      </div>

      <div className={styles.formGrid}>
        <label className={styles.formLabel}>
          Harvest date *
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
          Best before *
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
          label="Category"
          options={["Vegetables", "Fruits"] as const}
          value={form.category}
          onChange={(v) => onChange({ ...form, category: v })}
        />
        <TickGroup
          label="Unit"
          options={["kg", "lbs"] as const}
          value={form.unit}
          onChange={(v) => onChange({ ...form, unit: v })}
        />
      </div>

      <div className={styles.priceRow}>
        <label className={`${styles.formLabel} ${styles.grow1}`}>
          Price (₱)
          <input className={styles.formInput} type="number" min="0" value={form.price} onChange={(e) => onChange({ ...form, price: Number(e.target.value) })} />
        </label>
        <div className={styles.pricePerLabel}>per</div>
        <label className={`${styles.formLabel} ${styles.qtyField}`}>
          Quantity
          <input className={styles.formInput} type="number" min="0.1" step="0.1" value={form.unit_quantity ?? 1} onChange={(e) => onChange({ ...form, unit_quantity: Number(e.target.value) || 1 })} />
        </label>
        <div className={styles.priceUnitLabel}>{form.unit}</div>
      </div>

      {form.price > 0 && form.unit_quantity > 0 && (
        <div className={styles.pricePreview}>
          ₱{form.price} per {form.unit_quantity === 1 ? "" : form.unit_quantity}{form.unit}
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
        Description
        <textarea className={styles.formInput} rows={2} value={form.description} onChange={(e) => onChange({ ...form, description: e.target.value })} />
      </label>
    </>
  );
}
