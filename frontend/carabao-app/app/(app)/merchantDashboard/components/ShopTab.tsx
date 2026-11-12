import { useState, type ChangeEvent } from "react";
import styles from "../page.module.css";
import {
  createMyShopPage,
  updateMyShopPage,
  uploadBannerImage,
  uploadShopLogo,
  type Merchant,
  type ShopPage,
} from "@/util/api";
import StoreDetails from "./StoreDetails";

type Props = {
  shopPage: ShopPage | null;
  onShopPageChange: (page: ShopPage) => void;
  merchant: Merchant | null;
  onMerchantChange: (merchant: Merchant) => void;
};

export default function ShopTab({ shopPage, onShopPageChange, merchant, onMerchantChange }: Props) {
  return (
    <div className={styles.shopLayout}>
      <h2 className={styles.sectionTitle}>Shop Page</h2>
      {shopPage
        ? <ShopPageEditor shopPage={shopPage} onChange={onShopPageChange} />
        : <ShopPageCreateForm onCreated={onShopPageChange} />}
      <StoreDetails merchant={merchant} onSaved={onMerchantChange} />
    </div>
  );
}

function ShopPageCreateForm({ onCreated }: { onCreated: (page: ShopPage) => void }) {
  const [draft, setDraft] = useState({ title: "", description: "" });
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!draft.title.trim()) return;
    setCreating(true);
    const slug = draft.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    try {
      onCreated(await createMyShopPage({ title: draft.title.trim(), slug, description: draft.description.trim() || null }));
      setDraft({ title: "", description: "" });
    } catch { /* silently fail */ }
    finally { setCreating(false); }
  };

  return (
    <div className={styles.shopCreateForm}>
      <p className={`${styles.emptyText} ${styles.spaceBelow}`}>Set up your public shop page so customers can find you.</p>
      <label className={styles.formLabel}>Title *<input className={styles.formInput} value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="e.g. Dela Cruz Farm" /></label>
      <label className={`${styles.formLabel} ${styles.spaceAbove}`}>Description<textarea className={styles.formInput} rows={2} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder="Short description shown on your shop page" /></label>
      <div className={`${styles.formActions} ${styles.spaceAboveLg}`}>
        <button className={styles.primaryBtn} disabled={creating || !draft.title.trim()} onClick={() => void handleCreate()}>{creating ? "Creating…" : "Create Shop Page"}</button>
      </div>
    </div>
  );
}

function ShopPageEditor({ shopPage, onChange }: { shopPage: ShopPage; onChange: (page: ShopPage) => void }) {
  const [bannerUploading, setBannerUploading] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", description: "" });
  const [saving, setSaving] = useState(false);

  const upload = async (
    e: ChangeEvent<HTMLInputElement>,
    send: (file: File) => Promise<ShopPage>,
    setBusy: (busy: boolean) => void,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try { onChange(await send(file)); }
    catch { /* silently fail */ }
    finally { setBusy(false); e.target.value = ""; }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      onChange(await updateMyShopPage({ title: draft.title.trim() || undefined, description: draft.description.trim() || null }));
      setEditing(false);
    } catch { /* silently fail */ }
    finally { setSaving(false); }
  };

  return (
    <div className={styles.shopEditor}>
      <label className={styles.shopBannerWrap} title="Click to change banner">
        {bannerUploading ? (
          <div className={styles.shopBannerEmpty}>Uploading…</div>
        ) : shopPage.banner_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shopPage.banner_image_url} alt="Shop banner" className={styles.shopBannerImg} />
        ) : (
          <div className={styles.shopBannerEmpty}>Click to upload a banner image</div>
        )}
        <div className={styles.shopBannerOverlay}>Change Banner</div>
        <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={bannerUploading} onChange={(e) => void upload(e, uploadBannerImage, setBannerUploading)} />
      </label>

      <div className={styles.shopMetaRow}>
        <label className={styles.shopLogoWrap} title="Click to change logo">
          {logoUploading ? <div className={styles.shopLogoPlaceholder}>…</div>
            : shopPage.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shopPage.logo_url} alt="Shop logo" className={styles.shopLogoImg} />
            ) : (
              <div className={styles.shopLogoPlaceholder}>Logo</div>
            )}
          <div className={styles.shopLogoOverlay}>Change</div>
          <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={logoUploading} onChange={(e) => void upload(e, uploadShopLogo, setLogoUploading)} />
        </label>

        {editing ? (
          <div className={styles.shopInfoForm}>
            <label className={styles.formLabel}>Title<input className={styles.formInput} value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} /></label>
            <label className={`${styles.formLabel} ${styles.spaceAbove}`}>Description<textarea className={styles.formInput} rows={2} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} /></label>
            <div className={`${styles.formActions} ${styles.spaceAbove}`}>
              <button className={styles.primaryBtn} disabled={saving} onClick={() => void handleSave()}>{saving ? "Saving…" : "Save"}</button>
              <button className={styles.secondaryBtn} onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className={styles.shopInfoView}>
            <strong className={styles.shopInfoTitle}>{shopPage.title}</strong>
            {shopPage.description && <p className={styles.shopInfoDesc}>{shopPage.description}</p>}
            <button className={`${styles.uploadBtn} ${styles.spaceAbove}`} onClick={() => { setDraft({ title: shopPage.title, description: shopPage.description ?? "" }); setEditing(true); }}>Edit title & description</button>
          </div>
        )}
      </div>
    </div>
  );
}
