import styles from "../page.module.css";
import type { Produce, ProduceCreatePayload } from "@/util/api";

export type ProduceFormState = {
  name: string;
  description: string;
  category: "Vegetables" | "Fruits" | "";
  price: number;
  unit: "kg" | "lbs";
  unit_quantity: number;
  stock_quantity: number;
  image_url: string;
};

export const emptyProduceForm: ProduceFormState = {
  name: "", description: "", category: "", price: 0, unit: "kg", unit_quantity: 1, stock_quantity: 0, image_url: "",
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

      <label className={styles.formLabelFull}>
        Description
        <textarea className={styles.formInput} rows={2} value={form.description} onChange={(e) => onChange({ ...form, description: e.target.value })} />
      </label>
    </>
  );
}
