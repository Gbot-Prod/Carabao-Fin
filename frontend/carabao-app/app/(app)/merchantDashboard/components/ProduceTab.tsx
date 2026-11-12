import { useState, type ChangeEvent, type Dispatch, type FormEvent, type SetStateAction } from "react";
import styles from "../page.module.css";
import PageLoader from "@/components/PageLoader/PageLoader";
import { createProduce, deleteProduce, updateProduce, uploadProduceImage, type Produce } from "@/util/api";
import ProduceFormFields, { emptyProduceForm, formToPayload, produceToForm, type ProduceFormState } from "./ProduceFormFields";

type Props = {
  produces: Produce[];
  setProduces: Dispatch<SetStateAction<Produce[]>>;
  loading: boolean;
};

export default function ProduceTab({ produces, setProduces, loading }: Props) {
  const [uploadingIds, setUploadingIds] = useState<Set<number>>(new Set());
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<ProduceFormState>(emptyProduceForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<ProduceFormState>(emptyProduceForm);
  const [saving, setSaving] = useState(false);

  const replace = (updated: Produce) => setProduces((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));

  const startEdit = (p: Produce) => {
    setEditingId(p.id);
    setEditForm(produceToForm(p));
  };

  const handleImageUpload = async (produceId: number, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingIds((prev) => new Set(prev).add(produceId));
    try {
      const updated = await uploadProduceImage(produceId, file);
      replace(updated);
      if (editingId === produceId) setEditForm((prev) => ({ ...prev, image_url: updated.image_url ?? "" }));
    } catch { /* silently fail */ }
    finally {
      setUploadingIds((prev) => { const n = new Set(prev); n.delete(produceId); return n; });
      e.target.value = "";
    }
  };

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await createProduce(formToPayload(addForm));
      setProduces((prev) => [...prev, created]);
      setShowAddForm(false);
      setAddForm(emptyProduceForm);
    } catch { /* silently fail */ }
    finally { setSaving(false); }
  };

  const handleUpdate = async (e: FormEvent) => {
    e.preventDefault();
    if (editingId === null) return;
    setSaving(true);
    try {
      replace(await updateProduce(editingId, formToPayload(editForm)));
      setEditingId(null);
    } catch { /* silently fail */ }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Delete this produce item?")) return;
    try { await deleteProduce(id); setProduces((prev) => prev.filter((p) => p.id !== id)); }
    catch { /* silently fail */ }
  };

  return (
    <div className={styles.produceLayout}>
      <div className={styles.produceSectionHeader}>
        <h2 className={styles.sectionTitle}>Your Produce</h2>
        {!showAddForm && (
          <button className={styles.primaryBtn} onClick={() => { setShowAddForm(true); setEditingId(null); }}>
            + Add Produce
          </button>
        )}
      </div>

      {showAddForm && (
        <form onSubmit={(e) => void handleAdd(e)} className={styles.produceForm}>
          <p className={styles.formTitle}>New produce</p>
          <ProduceFormFields form={addForm} onChange={setAddForm} />
          <div className={styles.formActions}>
            <button type="submit" className={styles.primaryBtn} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            <button type="button" className={styles.secondaryBtn} onClick={() => { setShowAddForm(false); setAddForm(emptyProduceForm); }}>Cancel</button>
          </div>
        </form>
      )}

      {loading && <PageLoader variant="compact" label="Loading produce…" />}
      {!loading && produces.length === 0 && !showAddForm && (
        <p className={styles.emptyText}>No produce listed yet. Add your first item above.</p>
      )}

      <div className={styles.produceList}>
        {produces.map((produce) =>
          editingId === produce.id ? (
            <form key={produce.id} onSubmit={(e) => void handleUpdate(e)} className={styles.produceForm}>
              <p className={styles.formTitle}>Edit: {produce.name}</p>
              <ProduceFormFields form={editForm} onChange={setEditForm} />
              <div className={styles.formActions}>
                <button type="submit" className={styles.primaryBtn} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
                <button type="button" className={styles.secondaryBtn} onClick={() => setEditingId(null)}>Cancel</button>
              </div>
            </form>
          ) : (
            <div key={produce.id} className={styles.produceRow}>
              <label className={styles.produceThumbWrap} title="Click to upload image">
                {uploadingIds.has(produce.id) ? (
                  <div className={styles.produceThumbPlaceholder}>…</div>
                ) : produce.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={produce.image_url} alt={produce.name ?? ""} className={styles.produceThumb} />
                ) : (
                  <div className={styles.produceThumbPlaceholder}>+</div>
                )}
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={uploadingIds.has(produce.id)} onChange={(e) => void handleImageUpload(produce.id, e)} />
              </label>
              <div className={styles.produceRowInfo}>
                <strong className={styles.produceName}>{produce.name}</strong>
                {produce.category && <span className={styles.produceCategory}>{produce.category}</span>}
                <span className={styles.producePrice}>₱{produce.price} / {produce.unit_quantity !== 1 ? produce.unit_quantity : ""}{produce.unit}</span>
                <span className={styles.produceStock}>Stock: {produce.stock_quantity}</span>
                {produce.description && <p className={styles.produceDesc}>{produce.description}</p>}
              </div>
              <div className={styles.produceRowActions}>
                <button className={styles.secondaryBtn} onClick={() => startEdit(produce)}>Edit</button>
                <button className={styles.dangerBtn} onClick={() => void handleDelete(produce.id)}>Delete</button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
