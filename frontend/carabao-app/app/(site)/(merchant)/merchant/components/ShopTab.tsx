import { useState, type ChangeEvent } from "react";
import { SHOP_DESCRIPTION_MAX, SHOP_TITLE_MAX } from "@/lib/input-limits";
import styles from "../page.module.css";
import t from "./ShopTab.module.css";
import farm from "@/app/(site)/(app)/farms/page.module.css";
import getApiErrorMessage from "@/util/errorHelper";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useMerchant } from "../MerchantContext";
import { APPROVED_PUBLISH, PUBLISH_LOCKED } from "../lib/verification";
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

type Props = {
  shopPage: MyShopPage | null;
  merchant: Merchant | null;
  onShopPageChange: (page: MyShopPage) => void;
};

type View = "edit" | "preview" | "live";

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

// The public shop page (logo, banner, title). All edits go to a draft. Buyers
// see the draft only after the merchant publishes it. Before the first
// publish, buyers do not see the farm at all. Store details (address, pickup
// pin, delivery days) are next to it on the same page (StoreDetails).
export default function ShopTab({ shopPage, merchant, onShopPageChange }: Props) {
  const [view, setView] = useState<View>("edit");

  if (!shopPage) {
    return (
      <div className={styles.shopLayout}>
        <ShopPageCreateForm onCreated={onShopPageChange} />
      </div>
    );
  }

  const views: { key: View; label: string }[] = [
    { key: "edit", label: "Edit draft" },
    { key: "preview", label: "Preview draft" },
    ...(shopPage.is_published ? [{ key: "live" as const, label: "Live page" }] : []),
  ];
  const current = view === "live" && !shopPage.is_published ? "edit" : view;

  return (
    <div className={styles.shopLayout}>
      <PublishBar shopPage={shopPage} onChange={onShopPageChange} />

      <div className={t.views} role="tablist" aria-label="Shop page view">
        {views.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={current === v.key}
            className={`${t.viewBtn} ${current === v.key ? t.viewBtnOn : ""}`}
            onClick={() => setView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {current === "edit" && <ShopPageEditor shopPage={shopPage} onChange={onShopPageChange} />}
      {current === "preview" && <ShopPreview content={draftOf(shopPage)} merchant={merchant} label="Draft. Buyers do not see this version yet." />}
      {current === "live" && <ShopPreview content={liveOf(shopPage)} merchant={merchant} label="Live. Buyers see this version now." />}
    </div>
  );
}

type Action = "publish" | "unpublish" | "discard";

const FAIL_MESSAGE: Record<Action, string> = {
  publish: "Could not publish. Try again.",
  unpublish: "Could not unpublish. Try again.",
  discard: "Could not discard the draft. Try again.",
};

function PublishBar({ shopPage, onChange }: { shopPage: MyShopPage; onChange: (page: MyShopPage) => void }) {
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
        <p className={t.publishMsg}>{state.text}</p>
        {error && <p className={`${styles.errorText} ${t.publishMsg}`}>{error}</p>}
      </div>
      <div className={t.publishActions}>
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
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={busy !== null || !canPublish}
          title={!verified ? PUBLISH_LOCKED : !shopPage.draft_title.trim() ? "Add a title first" : undefined}
          aria-describedby={!verified ? "publish-locked" : undefined}
          onClick={() => void run("publish", publishMyShopPage)}
        >
          {busy === "publish" ? "Publishing…" : live ? "Publish changes" : "Publish shop"}
        </button>
        {!verified && (
          <p id="publish-locked" className={t.publishMsg}>
            {PUBLISH_LOCKED}
          </p>
        )}
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
    <div className={styles.shopCreateForm}>
      <p className={`${styles.emptyText} ${styles.spaceBelow}`}>
        Set up your shop page. Buyers do not see your farm until you publish it, so you can add a logo, banner and description first.
      </p>
      <label className={styles.formLabel}>Title *<input className={styles.formInput} value={draft.title} maxLength={SHOP_TITLE_MAX} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="e.g. Dela Cruz Farm" /></label>
      <label className={`${styles.formLabel} ${styles.spaceAbove}`}>Description<textarea className={styles.formInput} rows={2} value={draft.description} maxLength={SHOP_DESCRIPTION_MAX} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder="Short description shown on your shop page" /></label>
      {error && <p className={`${styles.errorText} ${styles.spaceAbove}`}>{error}</p>}
      <div className={`${styles.formActions} ${styles.spaceAboveLg}`}>
        <button className={styles.primaryBtn} disabled={creating || !draft.title.trim()} onClick={() => void handleCreate()}>{creating ? "Creating…" : "Start shop page draft"}</button>
      </div>
    </div>
  );
}

function ShopPageEditor({ shopPage, onChange }: { shopPage: MyShopPage; onChange: (page: MyShopPage) => void }) {
  const [bannerUploading, setBannerUploading] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (
    e: ChangeEvent<HTMLInputElement>,
    send: (file: File) => Promise<MyShopPage>,
    setBusy: (busy: boolean) => void,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try { onChange(await send(file)); }
    catch (err) { setError(getApiErrorMessage(err, "Image upload failed. Try again.")); }
    finally { setBusy(false); e.target.value = ""; }
  };

  const handleSave = async () => {
    if (!draft.title.trim()) {
      setError("Title is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onChange(await updateMyShopPage({ title: draft.title.trim(), description: draft.description.trim() || null }));
      setEditing(false);
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not save the draft. Try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.shopEditor}>
      {error && <p role="alert" className={styles.errorText}>{error}</p>}
      <label className={styles.shopBannerWrap} title="Click to change banner">
        {bannerUploading ? (
          <div className={styles.shopBannerEmpty}>Uploading…</div>
        ) : shopPage.draft_banner_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shopPage.draft_banner_image_url} alt="Shop banner (draft)" className={styles.shopBannerImg} />
        ) : (
          <div className={styles.shopBannerEmpty}>Click to upload a banner image</div>
        )}
        <div className={styles.shopBannerOverlay}>Change Banner</div>
        <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={bannerUploading} onChange={(e) => void upload(e, uploadBannerImage, setBannerUploading)} />
      </label>

      <div className={styles.shopMetaRow}>
        <label className={styles.shopLogoWrap} title="Click to change logo">
          {logoUploading ? <div className={styles.shopLogoPlaceholder}>…</div>
            : shopPage.draft_logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shopPage.draft_logo_url} alt="Shop logo (draft)" className={styles.shopLogoImg} />
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
              <button className={styles.primaryBtn} disabled={saving} onClick={() => void handleSave()}>{saving ? "Saving…" : "Save draft"}</button>
              <button className={styles.secondaryBtn} onClick={() => { setEditing(false); setError(null); }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className={styles.shopInfoView}>
            <strong className={styles.shopInfoTitle}>{shopPage.draft_title}</strong>
            {shopPage.draft_description && <p className={styles.shopInfoDesc}>{shopPage.draft_description}</p>}
            <button className={`${styles.uploadBtn} ${styles.spaceAbove}`} onClick={() => { setDraft({ title: shopPage.draft_title, description: shopPage.draft_description ?? "" }); setEditing(true); }}>Edit title & description</button>
          </div>
        )}
      </div>
      {error && <p className={`${styles.errorText} ${t.editorError}`}>{error}</p>}
    </div>
  );
}
