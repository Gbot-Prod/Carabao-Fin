"use client";

import MerchantPage from "../../MerchantPage";
import EarningsTab from "../../components/EarningsTab";

export default function MerchantEarningsPage() {
  return (
    <MerchantPage
      eyebrow="Sales"
      title="Earnings"
      description="Money from paid orders, payout details and cash out."
    >
      <EarningsTab />
    </MerchantPage>
  );
}
