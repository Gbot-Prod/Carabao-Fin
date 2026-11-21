import { useState, type ChangeEvent } from "react";
import { SHOP_DESCRIPTION_MAX, SHOP_TITLE_MAX } from "@/lib/input-limits";
import styles from "../page.module.css";
import t from "./ShopTab.module.css";
import c from "./ShopSettings.module.css";
import FieldError, { invalidClass, invalidProps } from "@/components/FieldError/FieldError";
import farm from "@/app/(site)/(app)/farms/page.module.css";
import getApiErrorMessage from "@/util/errorHelper";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useMerchant } from "../MerchantContext";
import { APPROVED_PUBLISH } from "../lib/verification";
import { shopSlug } from "@/lib/shop-slug";
import {
  createMyShopPage,
  discardMyShopPageDraft,
  publishMyShopPage,
  unpublishMyShopPage,
  updateMyShopPage,
  uploadBannerImage,
  uploadShopLogo,
  type Merchant,
  type MyShopPage,
} from "@/util/api";

export type View = "edit" | "preview" | "live";

/** The values one version of the page shows to buyers. */
type PageContent = {
  title: string;
  description: string | null;
  logo_url: string | null;
  banner_image_url: string | null;
};

const draftOf = (p: MyShopPage): PageContent => ({
  title: p.draft_title,
  description: p.draft_description,
  logo_url: p.draft_logo_url,
  banner_image_url: p.draft_banner_image_url,
});

const liveOf = (p: MyShopPage): PageContent => ({
  title: p.title,
  description: p.description,
  logo_url: p.logo_url,
  banner_image_url: p.banner_image_url,
});

type Props = {
  shopPage: MyShopPage | null;
  merchant: Merchant | null;
  onShopPageChange: (page: MyShopPage) => void;
  view: View;
  onViewChange: (view: View) => void;
};

// The public storefront card (logo, banner, title). All edits go to a draft.
// Buyers see the draft only after the merchant publishes it (PublishStatusBanner,
// at the top of the page). Before the first publish, buyers do not see the farm.
export default function ShopTab({ shopPage, merchant, onShopPageChange, view, onViewChange }: Props) {
  const views: { key: View; label: string }[] = shopPage
    ? [
        { key: "edit", label: "Edit draft" },
        { key: "preview", label: "Preview draft" },
        ...(shopPage.is_published ? [{ key: "live" as const, label: "Live page" }] : []),
      ]
    : [];
  const current = view === "live" && !shopPage?.is_published ? "edit" : view;

  return (
    <section id="storefront" className={c.section} aria-labelledby="storefront-title">
      <div className={c.sectionHead}>
        <h2 id="storefront-title" className={c.sectionTitle}>Public storefront</h2>
        {views.length > 0 && (
          <div className={t.views} role="tablist" aria-label="Shop page view">
            {views.map((v) => (
              <button
                key={v.key}
                type="button"
                role="tab"
                aria-selected={current === v.key}
                className={`${t.viewBtn} ${current === v.key ? t.viewBtnOn : ""}`}
                onClick={() => onViewChange(v.key)}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {!shopPage ? (
        <ShopPageCreateForm onCreated={onShopPageChange} />
      ) : current === "edit" ? (
        <ShopPageEditor shopPage={shopPage} onChange={onShopPageChange} />
      ) : current === "preview" ? (
        <ShopPreview content={draftOf(shopPage)} merchant={merchant} label="Draft. Buyers do not see this version yet." />
      ) : (
        <ShopPreview content={liveOf(shopPage)} merchant={merchant} label="Live. Buyers see this version now." />
      )}
    </section>
  );
}

type Action = "publish" | "unpublish" | "discard";

const FAIL_MESSAGE: Record<Action, string> = {
  publish: "Could not publish. Try again.",
  unpublish: "Could not unpublish. Try again.",
  discard: "Could not discard the draft. Try again.",
};

/** Top of the page: is the shop live, and the publish / preview actions. */
export function PublishStatusBanner({
  shopPage,
  onChange,
  onPreview,
}: {
  shopPage: MyShopPage;
  onChange: (page: MyShopPage) => void;
  onPreview: () => void;
}) {
  const { t: text } = useLanguage();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Publishing needs Carabao's approval (the API refuses it too). Approval
  // never publishes by itself: the merchant reviews prices and stock first.
  const verified = useMerchant().verificationStatus === "verified";
  const canPublish = verified && shopPage.draft_title.trim().length > 0 && shopPage.has_unpublished_changes;
  const live = shopPage.is_published;

  const run = async (kind: Action, send: () => Promise<MyShopPage>) => {
    if (kind === "discard" && !window.confirm(text.merchantConfirm.discardDraft)) return;
    if (kind === "unpublish" && !window.confirm(text.merchantConfirm.unpublishShop)) return;
    setBusy(kind);
    setError(null);
    try {
      onChange(await send());
    } catch (err) {
      setError(getApiErrorMessage(err, FAIL_MESSAGE[kind]));
    } finally {
      setBusy(null);
    }
  };

  let state: { tone: string; badge: string; text: string };
  if (!live && !verified) {
    state = {
      tone: t.toneDraft,
      badge: "Not live",
      text: "Buyers cannot see your farm yet. Set up your page now; you can publish once Carabao approves your documents.",
    };
  } else if (!live) {
    state = {
      tone: t.toneDraft,
      badge: "Not live",
      text: APPROVED_PUBLISH,
    };
  } else if (shopPage.has_unpublished_changes) {
    state = {
      tone: t.toneChanged,
      badge: "Unpublished changes",
      text: "Buyers still see the live page. Publish to show your changes.",
    };
  } else {
    state = {
      tone: t.toneLive,
      badge: "Live",
      text: "Buyers see this page. Your next edits stay in a draft until you publish.",
    };
  }

  return (
    <div className={`${t.publishBar} ${state.tone}`} role="status">
      <div className={t.publishText}>
        <span className={t.badge}>{state.badge}</span>
        <p id="publish-status" className={t.publishMsg}>{state.text}</p>
        {error && <p className={`${styles.errorText} ${t.publishMsg}`}>{error}</p>}
      </div>
      <div className={t.publishActions}>
        <button type="button" className={styles.secondaryBtn} onClick={onPreview}>
          Preview draft
        </button>
        {live && (
          <button type="button" className={styles.secondaryBtn} disabled={busy !== null} onClick={() => void run("unpublish", unpublishMyShopPage)}>
            {busy === "unpublish" ? "Unpublishing…" : "Unpublish"}
          </button>
        )}
        {live && shopPage.has_unpublished_changes && (
          <button type="button" className={styles.secondaryBtn} disabled={busy !== null} onClick={() => void run("discard", discardMyShopPageDraft)}>
            {busy === "discard" ? "Discarding…" : "Discard changes"}
          </button>
        )}
        {/* The hover note sits on a wrapper: a disabled button shows no tooltip in some browsers. */}
        <span
          className={t.publishWrap}
          title={!verified ? "Available once your documents are approved." : !shopPage.draft_title.trim() ? "Add a title first" : undefined}
        >
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={busy !== null || !canPublish}
            aria-describedby={!verified ? "publish-status" : undefined}
            onClick={() => void run("publish", publishMyShopPage)}
          >
            {busy === "publish" ? "Publishing…" : live ? "Publish changes" : "Publish shop"}
          </button>
        </span>
      </div>
    </div>
  );
}

/** How buyers see the top of the farm page (same styles as the farm page). */
function ShopPreview({ content, merchant, label }: { content: PageContent; merchant: Merchant | null; label: string }) {
  const name = merchant?.merchant_name ?? content.title;
  const place = merchant ? [merchant.city, merchant.province].filter(Boolean).join(", ") : "";
  return (
    <div className={t.preview}>
      <p className={t.previewLabel}>{label}</p>
      <div className={farm.merchantHeader}>
        {content.banner_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={content.banner_image_url} alt="" className={farm.shopBanner} />
        ) : (
          <div className={farm.shopBannerPlaceholder} />
        )}
        <div className={`${farm.merchantHeaderBody} ${t.previewBody}`}>
          {content.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={content.logo_url} alt="" className={farm.merchantImage} />
          ) : null}
          <div className={farm.merchantInfo}>
            <h3 className={`${farm.merchantName} ${t.previewName}`}>{name}</h3>
            {place && <p className={farm.merchantLocation}>{place}</p>}
            {content.description && <p className={farm.merchantDesc}>{content.description}</p>}
          </div>
        </div>
      </div>
      <p className={t.previewMeta}>
        Page title in search results and the browser tab: <strong>{content.title || "—"}</strong>
      </p>
    </div>
  );
}

function ShopPageCreateForm({ onCreated }: { onCreated: (page: MyShopPage) => void }) {
  const [draft, setDraft] = useState({ title: "", description: "" });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!draft.title.trim()) return;
    // Lowercase words joined by hyphens, 3 to 80 characters (CF-0043).
    // CF-0053: accents folded ("Niño" -> "nino"); a title with too few letters
    // or digits gets shop-<time>, so any title can start a shop page.
    const base = shopSlug(draft.title, Date.now().toString(36));
    const slug = base.length >= 3 ? base : shopSlug("", Date.now().toString(36));
    setCreating(true);
    setError(null);
    try {
      onCreated(await createMyShopPage({ title: draft.title.trim(), slug, description: draft.description.trim() || null }));
      setDraft({ title: "", description: "" });
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not create the shop page. Try again."));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={c.fields}>
      <p className={c.muted}>
        Set up your shop page. Buyers do not see your farm until you publish it, so you can add a logo, banner and description first.
      </p>
      <label className={styles.formLabel}>Title *<input className={styles.formInput} value={draft.title} maxLength={SHOP_TITLE_MAX} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="e.g. Dela Cruz Farm" /></label>
      <label className={styles.formLabel}>Description<textarea className={styles.formInput} rows={2} value={draft.description} maxLength={SHOP_DESCRIPTION_MAX} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder="Short description shown on your shop page" /></label>
      {error && <p className={styles.errorText} role="alert">{error}</p>}
      <div className={c.actions}>
        <button className={styles.primaryBtn} disabled={creating || !draft.title.trim()} onClick={() => void handleCreate()}>{creating ? "Creating…" : "Start shop page draft"}</button>
      </div>
    </div>
  );
}

const IMAGE_TYPES = "image/png,image/jpeg,image/webp";

function ShopPageEditor({ shopPage, onChange }: { shopPage: MyShopPage; onChange: (page: MyShopPage) => void }) {
  const [bannerUploading, setBannerUploading] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const upload = async (
    e: ChangeEvent<HTMLInputElement>,
    send: (file: File) => Promise<MyShopPage>,
    setBusy: (busy: boolean) => void,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setUploadError(null);
    try { onChange(await send(file)); }
    catch (err) { setUploadError(getApiErrorMessage(err, "Image upload failed. Try again.")); }
    finally { setBusy(false); e.target.value = ""; }
  };

  const startEditing = () => {
    setDraft({ title: shopPage.draft_title, description: shopPage.draft_description ?? "" });
    setTitleError(null);
    setSaveError(null);
    setEditing(true);
  };

  const handleSave = async () => {
    if (!draft.title.trim()) {
      setTitleError("Enter a title for your shop.");
      document.getElementById("shop-title")?.focus();
      return;
    }
    setSaving(true);
    setTitleError(null);
    setSaveError(null);
    try {
      onChange(await updateMyShopPage({ title: draft.title.trim(), description: draft.description.trim() || null }));
      setEditing(false);
    } catch (err) {
      setSaveError(getApiErrorMessage(err, "Could not save the draft. Try again."));
    } finally {
      setSaving(false);
    }
  };

  const banner = shopPage.draft_banner_image_url;
  const logo = shopPage.draft_logo_url;

  return (
    <>
      <label className={c.banner}>
        {bannerUploading ? (
          <div className={c.bannerEmpty}>Uploading…</div>
        ) : banner ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={banner} alt="Shop banner (draft)" className={c.bannerImg} />
        ) : (
          <div className={c.bannerEmpty}>
            Add a banner image
            <small>Shown across the top of your shop page</small>
          </div>
        )}
        {!bannerUploading && <span className={c.chip} aria-hidden="true">{banner ? "Replace banner" : "Upload banner"}</span>}
        <input type="file" accept={IMAGE_TYPES} className={c.fileInput} aria-label={banner ? "Replace banner image" : "Upload banner image"} disabled={bannerUploading} onChange={(e) => void upload(e, uploadBannerImage, setBannerUploading)} />
      </label>
      <p className={c.hint}>Wide image, about 4:1 (for example 1600 × 400 px). JPG, PNG or WebP.</p>
      {uploadError && <p className={styles.errorText} role="alert">{uploadError}</p>}

      <div className={c.identity}>
        <label className={c.logo}>
          {logoUploading ? (
            <div className={c.logoEmpty}>…</div>
          ) : logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="Shop logo (draft)" />
          ) : (
            <div className={c.logoEmpty}>Logo</div>
          )}
          {!logoUploading && <span className={c.chip} aria-hidden="true">{logo ? "Change" : "Upload"}</span>}
          <input type="file" accept={IMAGE_TYPES} className={c.fileInput} aria-label={logo ? "Change logo" : "Upload logo"} disabled={logoUploading} onChange={(e) => void upload(e, uploadShopLogo, setLogoUploading)} />
        </label>

        {editing ? (
          <div className={c.identityForm}>
            <label className={`${styles.formLabel}${invalidClass(titleError)}`}>
              Title
              <input id="shop-title" className={styles.formInput} maxLength={SHOP_TITLE_MAX} value={draft.title} onChange={(e) => { setDraft((d) => ({ ...d, title: e.target.value })); setTitleError(null); }} {...invalidProps("shop-title", titleError)} />
              <FieldError id="shop-title" message={titleError} />
            </label>
            <label className={styles.formLabel}>Description<textarea className={styles.formInput} rows={3} maxLength={SHOP_DESCRIPTION_MAX} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder="What you grow, how you farm, where you are" /></label>
            {saveError && <p className={styles.errorText} role="alert">{saveError}</p>}
            <div className={c.actions}>
              <button className={styles.primaryBtn} disabled={saving} onClick={() => void handleSave()}>{saving ? "Saving…" : "Save draft"}</button>
              <button className={styles.secondaryBtn} disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className={c.identityText}>
            <h3 className={c.identityTitle}>{shopPage.draft_title}</h3>
            <p className={c.identityDesc}>{shopPage.draft_description || <em>No description yet. Tell buyers about your farm.</em>}</p>
            <button type="button" className={styles.secondaryBtn} onClick={startEditing}>Edit info</button>
          </div>
        )}
      </div>
    </>
  );
}
