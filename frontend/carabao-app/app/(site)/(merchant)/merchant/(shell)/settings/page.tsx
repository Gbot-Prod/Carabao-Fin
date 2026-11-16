"use client";

import { useMerchant } from "../../MerchantContext";
import MerchantPage from "../../MerchantPage";
import StoreDetails from "../../components/StoreDetails";
import DangerZone from "../../components/DangerZone";

export default function MerchantSettingsPage() {
  const { merchant, setMerchant } = useMerchant();
  return (
    <MerchantPage
      eyebrow="Store"
      title="Settings"
      description="Farm address, pickup point, delivery days, delivery price and contact number."
    >
      <StoreDetails merchant={merchant} onSaved={setMerchant} />
      <DangerZone />
    </MerchantPage>
  );
}
