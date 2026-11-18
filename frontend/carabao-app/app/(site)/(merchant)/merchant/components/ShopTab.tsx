import { useState, type ChangeEvent } from "react";
import { SHOP_DESCRIPTION_MAX, SHOP_TITLE_MAX } from "@/lib/input-limits";
import styles from "../page.module.css";
import getApiErrorMessage from "@/util/errorHelper";
import { shopSlug } from "@/lib/shop-slug";
import {
  createMyShopPage,
  updateMyShopPage,
  uploadBannerImage,
  uploadShopLogo,
  type ShopPage,
} from "@/util/api";
type Props = {
  shopPage: ShopPage | null;
  onShopPageChange: (page: ShopPage) => void;
};

// The public shop page (logo, banner, title). Store details (address, pickup
// pin, delivery days) are on the Settings page (StoreDetails).
export default function ShopTab({ shopPage, onShopPageChange }: Props) {
  return (
    <div className={styles.shopLayout}>
      {shopPage
        ? <ShopPageEditor shopPage={shopPage} onChange={onShopPageChange} />
        : <ShopPageCreateForm onCreated={onShopPageChange} />}
    </div>
  );
}

function ShopPageCreateForm({ onCreated }: { onCreated: (page: ShopPage) => void }) {
  const [draft, setDraft] = useState({ title: "", description: "" });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!draft.title.trim()) return;
    setCreating(true);
    setError(null);
    // CF-0053: never empty (titles with no ASCII letters), always API-valid.
    const slug = shopSlug(draft.title, Date.now().toString(36));
    try {
      onCreated(await createMyShopPage({ title: draft.title.trim(), slug, description: draft.description.trim() || null }));
      setDraft({ title: "", description: "" });
    } catch (err) {
      setError(getApiErrorMessage(err, "The shop page could not be created."));
    }
    finally { setCreating(false); }
  };

  return (
    <div className={styles.shopCreateForm}>
      <p className={`${styles.emptyText} ${styles.spaceBelow}`}>Set up your public shop page so customers can find you.</p>
      {error && <p role="alert" className={styles.errorText}>{error}</p>}
      <label className={styles.formLabel}>Title *<input className={styles.formInput} maxLength={SHOP_TITLE_MAX} value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="e.g. Dela Cruz Farm" /></label>
      <label className={`${styles.formLabel} ${styles.spaceAbove}`}>Description<textarea className={styles.formInput} rows={2} maxLength={SHOP_DESCRIPTION_MAX} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder="Short description shown on your shop page" /></label>
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
  const [error, setError] = useState<string | null>(null);

  const upload = async (
    e: ChangeEvent<HTMLInputElement>,
    send: (file: File) => Promise<ShopPage>,
    setBusy: (busy: boolean) => void,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try { onChange(await send(file)); }
    catch (err) { setError(getApiErrorMessage(err, "The image could not be uploaded.")); }
    finally { setBusy(false); e.target.value = ""; }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      onChange(await updateMyShopPage({ title: draft.title.trim() || undefined, description: draft.description.trim() || null }));
      setEditing(false);
    } catch (err) {
      setError(getApiErrorMessage(err, "The changes could not be saved."));
    }
    finally { setSaving(false); }
  };

  return (
    <div className={styles.shopEditor}>
      {error && <p role="alert" className={styles.errorText}>{error}</p>}
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
            <label className={styles.formLabel}>Title<input className={styles.formInput} maxLength={SHOP_TITLE_MAX} value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} /></label>
            <label className={`${styles.formLabel} ${styles.spaceAbove}`}>Description<textarea className={styles.formInput} rows={2} maxLength={SHOP_DESCRIPTION_MAX} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} /></label>
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
