"use client";

import { useState } from "react";
import PageLoader from "@/components/PageLoader/PageLoader";
import { appUrl } from "@/lib/urls";
import { useMerchant } from "../../MerchantContext";
import MerchantPage from "../../MerchantPage";
import ShopTab, { PublishStatusBanner, type View } from "../../components/ShopTab";
import StoreDetails from "../../components/StoreDetails";
import DangerZone from "../../components/DangerZone";
import HolidayModePanel from "../../components/HolidayModePanel";
import styles from "../../page.module.css";
import s from "./shop.module.css";
import c from "../../components/ShopSettings.module.css";

// The publish status, then one long card: the public storefront, store details
// (address, pickup pin, delivery days and price, contact number), shop close
// mode, and deleting the merchant profile.
export default function MerchantShopPage() {
  const { shopPage, setShopPage, merchant, setMerchant, performance, produceLoading } = useMerchant();
  const [view, setView] = useState<View>("edit");
  // Until the shop data loads, a missing page or empty details are not known to be missing.
  const loading = produceLoading && !shopPage && !merchant;

  const previewDraft = () => {
    setView("preview");
    document.getElementById("storefront")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <MerchantPage
      eyebrow="Store"
      title="Shop & settings"
      wideDescription
      description="Your public shop page, and the farm details that buyers and deliveries use. Shop page edits stay in a draft until you publish them."
      actions={
        // The farm page shows only after the first publish.
        performance && shopPage?.is_published && (
          <a className={styles.secondaryBtn} href={appUrl(`/farms/${performance.merchant_id}`)} target="_blank" rel="noreferrer">
            View shop ↗
          </a>
        )
      }
    >
      {loading ? (
        <PageLoader variant="inline" label="Loading shop and store details…" />
      ) : (
        <div className={s.stack}>
          {shopPage && <PublishStatusBanner shopPage={shopPage} onChange={setShopPage} onPreview={previewDraft} />}
          <div className={c.sheet}>
            <ShopTab
              shopPage={shopPage}
              merchant={merchant}
              onShopPageChange={setShopPage}
              onMerchantSaved={setMerchant}
              view={view}
              onViewChange={setView}
            />
            {(!shopPage || view !== "edit") && (
              <StoreDetails merchant={merchant} onSaved={setMerchant} />
            )}
            {/* CF-0066: was on the old settings page. */}
            <HolidayModePanel merchant={merchant} onSaved={setMerchant} />
            <DangerZone />
          </div>
        </div>
      )}
    </MerchantPage>
  );
}
