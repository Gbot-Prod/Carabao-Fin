"use client";

import { useRouter } from "next/navigation";
import { merchantUrl } from "@/lib/urls";
import { useMerchant } from "../../MerchantContext";
import MerchantPage from "../../MerchantPage";
import ReviewsTab from "../../components/ReviewsTab";

export default function MerchantReviewsPage() {
  const { performance } = useMerchant();
  const router = useRouter();
  const count = performance?.rating_count ?? 0;
  return (
    <MerchantPage
      eyebrow="Sales"
      title="Reviews"
      count={count || undefined}
      description="What buyers said about their orders."
    >
      <ReviewsTab onViewOrder={(orderId) => router.push(merchantUrl(`/sales?order=${orderId}`))} />
    </MerchantPage>
  );
}
