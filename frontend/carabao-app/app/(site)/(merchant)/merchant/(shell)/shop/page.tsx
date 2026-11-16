"use client";

import { appUrl } from "@/lib/urls";
import { useMerchant } from "../../MerchantContext";
import MerchantPage from "../../MerchantPage";
import ShopTab from "../../components/ShopTab";
import styles from "../../page.module.css";

export default function MerchantShopPage() {
  const { shopPage, setShopPage, performance } = useMerchant();
  return (
    <MerchantPage
      eyebrow="Store"
      title="Shop page"
      description="The public page that buyers see: logo, banner, title and description."
      actions={
        performance && (
          <a className={styles.secondaryBtn} href={appUrl(`/farms/${performance.merchant_id}`)} target="_blank" rel="noreferrer">
            View shop ↗
          </a>
        )
      }
    >
      <ShopTab shopPage={shopPage} onShopPageChange={setShopPage} />
    </MerchantPage>
  );
}
