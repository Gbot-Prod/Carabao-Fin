"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { merchantUrl } from "@/lib/urls";
import { useMerchant } from "../../MerchantContext";
import MerchantPage from "../../MerchantPage";
import OrdersTab from "../../components/OrdersTab";

// "/sales", not "/orders": /orders is a buyer page and merchant.<root> sends it to the apex.
export default function MerchantSalesPage() {
  const { ordersState } = useMerchant();
  const router = useRouter();
  const params = useSearchParams();
  // "?order=<id>" (from a review): scroll to that order and highlight it.
  const focusOrderId = Number(params.get("order")) || null;
  const clearFocus = useCallback(() => router.replace(merchantUrl("/sales"), { scroll: false }), [router]);

  return (
    <MerchantPage
      eyebrow="Sales"
      title="Orders"
      count={ordersState.loaded ? ordersState.orders.length : undefined}
      description="Confirm, prepare and follow the orders from your buyers."
    >
      <OrdersTab
        ordersState={ordersState}
        focusOrderId={focusOrderId}
        onFocusDone={clearFocus}
        onOpenShipments={() => router.push(merchantUrl("/shipments"))}
      />
    </MerchantPage>
  );
}
