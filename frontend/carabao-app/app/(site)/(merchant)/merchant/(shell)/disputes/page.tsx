"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { merchantUrl } from "@/lib/urls";
import MerchantPage from "../../MerchantPage";
import DisputesTab from "../../components/DisputesTab";

export default function MerchantDisputesPage() {
  const router = useRouter();
  const [openCount, setOpenCount] = useState<number | undefined>(undefined);
  return (
    <MerchantPage
      eyebrow="Sales"
      title="Disputes"
      count={openCount || undefined}
      description="Orders a buyer says did not arrive after you marked them delivered. Their payout waits while Carabao checks your drop-off photo. Add your side to help."
    >
      <DisputesTab
        onViewOrder={(orderId) => router.push(merchantUrl(`/sales?order=${orderId}`))}
        onOpenCount={setOpenCount}
      />
    </MerchantPage>
  );
}
