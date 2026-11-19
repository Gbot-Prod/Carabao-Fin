"use client";

import MerchantPage from "../../MerchantPage";
import VouchersTab from "../../components/VouchersTab";

export default function MerchantVouchersPage() {
  return (
    <MerchantPage
      eyebrow="Store"
      title="Vouchers"
      description="Discount codes for your farm. Your farm pays for the discount."
    >
      <VouchersTab />
    </MerchantPage>
  );
}
