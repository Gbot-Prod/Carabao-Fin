"use client";

import PageLoader from "@/components/PageLoader/PageLoader";
import { appUrl } from "@/lib/urls";
import { useMerchant } from "../../MerchantContext";
import MerchantPage from "../../MerchantPage";
import ShopTab from "../../components/ShopTab";
import StoreDetails from "../../components/StoreDetails";
import DangerZone from "../../components/DangerZone";
import styles from "../../page.module.css";
import s from "./shop.module.css";

// One page for what buyers see (shop page) and how the farm works (store
// details: address, pickup pin, delivery days and price, contact number).
export default function MerchantShopPage() {
  const { shopPage, setShopPage, merchant, setMerchant, performance, produceLoading } = useMerchant();
  // Until the shop data loads, a missing page or empty details are not known to be missing.
  const loading = produceLoading && !shopPage && !merchant;
  return (
    <MerchantPage
      eyebrow="Store"
      title="Shop & settings"
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
        <div className={s.columns}>
          <section className={s.column} aria-labelledby="shop-public">
            <h2 id="shop-public" className={s.heading}>Public shop page</h2>
            <ShopTab shopPage={shopPage} merchant={merchant} onShopPageChange={setShopPage} />
          </section>
          <section className={s.column} aria-labelledby="shop-settings">
            <h2 id="shop-settings" className={s.heading}>Store settings</h2>
            <StoreDetails merchant={merchant} onSaved={setMerchant} />
          </section>
        </div>
      )}
      <div className={s.danger}>
        <DangerZone />
      </div>
    </MerchantPage>
  );
}
