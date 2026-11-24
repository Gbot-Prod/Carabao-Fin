import { useCallback, useEffect, useState, type ChangeEvent, type Dispatch, type FormEvent, type SetStateAction } from "react";
import styles from "../page.module.css";
import PageLoader from "@/components/PageLoader/PageLoader";
import { createProduce, deleteProduce, fetchListingStanding, fetchMyProduce, updateProduce, uploadProduceImage, type ListingStanding, type Produce } from "@/util/api";
import getApiErrorMessage, { getApiErrorStatus, getApiFieldErrors } from "@/util/errorHelper";
import ProduceFormFields, { CHECKED_FIELDS, emptyProduceForm, formToPayload, produceToForm, type ProduceFormState } from "./ProduceFormFields";
import useListingCheck from "./useListingCheck";
import { hasBlocks, notesByField, savedMessage, standingNote, statusNote, unplacedMessages } from "@/lib/listing-checks";
import { formatRequestedDate, todayInManila } from "../lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

type Props = {
  produces: Produce[];
  setProduces: Dispatch<SetStateAction<Produce[]>>;
  loading: boolean;
};

export default function ProduceTab({ produces, setProduces, loading }: Props) {
  const { t } = useLanguage();
  const [uploadingIds, setUploadingIds] = useState<Set<number>>(new Set());
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<ProduceFormState>(emptyProduceForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<ProduceFormState>(emptyProduceForm);
  const [saving, setSaving] = useState(false);
  // CF-0053: API refusals (422 limits, 400 image rules, failed upload) are shown.
  const [actionError, setActionError] = useState<string | null>(null);
  // Guardrails Phase 1: the save's per-field refusal, and the note after a save.
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  // Guardrails Phase 2: penalty points and the new-farm review.
  const [standing, setStanding] = useState<ListingStanding | null>(null);
  const loadStanding = useCallback(() => {
    fetchListingStanding().then(setStanding).catch(() => { /* the banner is optional */ });
  }, []);
  useEffect(() => { loadStanding(); }, [loadStanding]);
  const canCreate = standing?.can_create_listings ?? true;
  const addCheck = useListingCheck(addForm, null, showAddForm);
  const editCheck = useListingCheck(editForm, editingId, editingId !== null);
  const addNotes = notesByField(addCheck, showAddForm ? saveErrors : {});
  const editNotes = notesByField(editCheck, editingId !== null ? saveErrors : {});

  /** The refusal per field when the server sent one, else the message on top. */
  const showSaveError = (err: unknown, fallback: string) => {
    const fields = getApiFieldErrors(err);
    setSaveErrors(fields);
    const unplaced = unplacedMessages(notesByField(null, fields), CHECKED_FIELDS);
    setActionError(
      Object.keys(fields).length === 0
        ? getApiErrorMessage(err, fallback)
        : unplaced.length > 0
          ? unplaced.join(" ")
          : "Correct the problems shown under the fields.",
    );
  };
  const resetMessages = () => {
    setActionError(null);
    setSaveErrors({});
    setNotice(null);
  };

  const replace = (updated: Produce) => setProduces((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));

  const startEdit = (p: Produce) => {
    resetMessages();
    setEditingId(p.id);
    setEditForm(produceToForm(p));
  };

  const handleImageUpload = async (produceId: number, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingIds((prev) => new Set(prev).add(produceId));
    setActionError(null);
    try {
      const updated = await uploadProduceImage(produceId, file);
      replace(updated);
      // Guardrails Phase 2: a new photo is checked again.
      if (produces.find((p) => p.id === produceId)?.status === "live" && updated.status === "under_review") {
        setNotice(savedMessage(updated.status));
      }
      if (editingId === produceId) setEditForm((prev) => ({ ...prev, image_url: updated.image_url ?? "" }));
    } catch (err) { setActionError(getApiErrorMessage(err, "The photo could not be uploaded.")); }
    finally {
      setUploadingIds((prev) => { const n = new Set(prev); n.delete(produceId); return n; });
      e.target.value = "";
    }
  };

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    resetMessages();
    try {
      const created = await createProduce(formToPayload(addForm));
      setProduces((prev) => [...prev, created]);
      setShowAddForm(false);
      setAddForm(emptyProduceForm);
      setNotice(savedMessage(created.status));
      loadStanding();
    } catch (err) {
      showSaveError(err, "The produce could not be added.");
      if (getApiErrorStatus(err) === 403) loadStanding();
    }
    finally { setSaving(false); }
  };

  const handleUpdate = async (e: FormEvent) => {
    e.preventDefault();
    if (editingId === null) return;
    setSaving(true);
    resetMessages();
    const loaded = produces.find((p) => p.id === editingId);
    try {
      const updated = await updateProduce(editingId, {
        ...formToPayload(editForm),
        expected_stock_quantity: loaded?.stock_quantity ?? null,
      });
      replace(updated);
      setEditingId(null);
      if (loaded?.status !== "under_review") setNotice(savedMessage(updated.status));
    } catch (err) {
      showSaveError(err, "The changes could not be saved.");
      // CF-0049: orders changed the stock while the form was open. Load the
      // new stock into the form; the message above says what happened.
      if (getApiErrorStatus(err) === 409) {
        try {
          const fresh = await fetchMyProduce();
          setProduces(fresh);
          const current = fresh.find((p) => p.id === editingId);
          if (current) setEditForm((prev) => ({ ...prev, stock_quantity: produceToForm(current).stock_quantity }));
        } catch { /* keep the form as it is */ }
      }
    }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm(t.merchantConfirm.deleteProduce)) return;
    setActionError(null);
    try { await deleteProduce(id); setProduces((prev) => prev.filter((p) => p.id !== id)); }
    catch (err) { setActionError(getApiErrorMessage(err, "The produce could not be deleted.")); }
  };

  return (
    <div className={styles.fillPage}>
      <section className={`${styles.panel} ${styles.listPanel}`} aria-labelledby="produce-title">
        <div className={styles.produceSectionHeader}>
          <h2 className={`${styles.sectionTitle} ${styles.flush}`} id="produce-title">Your Produce</h2>
          {actionError && <p role="alert" className={styles.errorText}>{actionError}</p>}
          {notice && <p role="status" className={styles.formNotice}>{notice}</p>}
          {!showAddForm && (
            <button
              className={styles.primaryBtn}
              disabled={!canCreate}
              title={canCreate ? undefined : "Too many penalty points: you cannot make new listings for now."}
              onClick={() => { resetMessages(); setShowAddForm(true); setEditingId(null); }}
            >
              + Add Produce
            </button>
          )}
        </div>
        <StandingBanner standing={standing} />

        {showAddForm && (
          <form onSubmit={(e) => void handleAdd(e)} className={styles.produceForm}>
            <p className={styles.formTitle}>{t.listing.newProduce}</p>
            <ProduceFormFields form={addForm} onChange={setAddForm} notes={addNotes} />
            <div className={styles.formActions}>
              <button type="submit" className={styles.primaryBtn} disabled={saving || hasBlocks(addNotes)}>{saving ? t.listing.saving : t.listing.save}</button>
              <button type="button" className={styles.secondaryBtn} onClick={() => { resetMessages(); setShowAddForm(false); setAddForm(emptyProduceForm); }}>{t.listing.cancel}</button>
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
                <ProduceFormFields form={editForm} onChange={setEditForm} notes={editNotes} />
                <div className={styles.formActions}>
                  <button type="submit" className={styles.primaryBtn} disabled={saving || hasBlocks(editNotes)}>{saving ? t.listing.saving : t.listing.saveChanges}</button>
                  <button type="button" className={styles.secondaryBtn} onClick={() => { resetMessages(); setEditingId(null); }}>{t.listing.cancel}</button>
                </div>
              </form>
            ) : (
              <div key={produce.id} className={styles.produceRow}>
                <label className={styles.produceThumbWrap} title="Click to upload image">
                  {uploadingIds.has(produce.id) ? (
                    <div className={styles.produceThumbPlaceholder}>…</div>
                  ) : produce.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={produce.image_url} alt={produce.name ? `Photo of ${produce.name}` : "Produce photo"} className={styles.produceThumb} />
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
                  {(produce.min_order_qty > 1 || produce.price_tiers.length > 0) && (
                    <span className={styles.produceFreshness}>
                      {produce.min_order_qty > 1 && `Min. order ${produce.min_order_qty}`}
                      {produce.min_order_qty > 1 && produce.price_tiers.length > 0 && " · "}
                      {produce.price_tiers.map((t) => `${t.min_qty}+ → ₱${t.unit_price}`).join(" · ")}
                    </span>
                  )}
                  {produce.harvest_date && produce.best_before ? (
                    <span className={styles.produceFreshness}>
                      Harvested {formatRequestedDate(produce.harvest_date)} · Best before {formatRequestedDate(produce.best_before)}
                      {produce.best_before < todayInManila() && (
                        <span className={styles.produceExpired}>Expired · hidden from buyers</span>
                      )}
                    </span>
                  ) : (
                    <span className={styles.produceFreshness}>Harvest date not set. Edit to add it.</span>
                  )}
                  {produce.hidden_at && (
                    <p className={styles.produceHidden} role="status">
                      <strong>Hidden by Carabao admin</strong> · buyers can&apos;t see or order this listing.
                      {produce.hidden_reason && <> Reason: {produce.hidden_reason}</>} Contact support once it&apos;s fixed.
                    </p>
                  )}
                  {!produce.hidden_at && <ReviewState produce={produce} />}
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
      </section>
    </div>
  );
}

/** Guardrails Phase 1: under review or rejected, on the merchant's own row. */
function ReviewState({ produce }: { produce: Produce }) {
  const note = statusNote(produce);
  if (!note) return null;
  return (
    <p className={note.tone === "rejected" ? styles.produceRejected : styles.produceReview} role="status">
      {note.text}
    </p>
  );
}

/** Guardrails Phase 2: penalty points, the new-listing block, new-farm review. */
function StandingBanner({ standing }: { standing: ListingStanding | null }) {
  const note = standingNote(standing);
  if (!note) return null;
  return (
    <div className={note.tone === "blocked" ? styles.produceRejected : styles.produceReview} role="status">
      {note.lines.map((line) => <p key={line} className={styles.standingLine}>{line}</p>)}
    </div>
  );
}
