"use client";

import PageLoader from "@/components/PageLoader/PageLoader";
import { useMerchant } from "../../MerchantContext";
import MerchantPage from "../../MerchantPage";
import StoreDetails from "../../components/StoreDetails";
import DangerZone from "../../components/DangerZone";
import HolidayModePanel from "../../components/HolidayModePanel";

export default function MerchantSettingsPage() {
  const { merchant, setMerchant, produceLoading } = useMerchant();
  return (
    <MerchantPage
      eyebrow="Store"
      title="Settings"
      description="Farm address, pickup point, delivery days, delivery price and contact number."
    >
      {/* Do not show an empty form before the saved details load. */}
      {produceLoading && !merchant ? (
        <PageLoader variant="inline" label="Loading store details…" />
      ) : (
        <>
          <HolidayModePanel merchant={merchant} onSaved={setMerchant} />
          <StoreDetails merchant={merchant} onSaved={setMerchant} />
        </>
      )}
      <DangerZone />
    </MerchantPage>
  );
}
