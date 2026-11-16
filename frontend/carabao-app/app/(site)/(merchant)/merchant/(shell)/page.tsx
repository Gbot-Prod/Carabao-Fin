"use client";

import { useRouter } from "next/navigation";
import { merchantUrl } from "@/lib/urls";
import { useReadyMerchant } from "../MerchantContext";
import MerchantPage from "../MerchantPage";
import OverviewTab from "../components/OverviewTab";

export default function MerchantDashboardPage() {
  const { performance, produces } = useReadyMerchant();
  const router = useRouter();
  return (
    <MerchantPage eyebrow="Overview" title="Dashboard">
      <OverviewTab
        performance={performance}
        produces={produces}
        onOpenReviews={() => router.push(merchantUrl("/reviews"))}
        onOpenOrders={() => router.push(merchantUrl("/sales"))}
      />
    </MerchantPage>
  );
}
