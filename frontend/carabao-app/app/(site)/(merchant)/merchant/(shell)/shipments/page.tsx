"use client";

import { useRouter } from "next/navigation";
import { merchantUrl } from "@/lib/urls";
import { useMerchant } from "../../MerchantContext";
import MerchantPage from "../../MerchantPage";
import ShipmentsTab from "../../components/ShipmentsTab";

export default function MerchantShipmentsPage() {
  const { ordersState, shipmentSelection } = useMerchant();
  const router = useRouter();
  const ready = ordersState.readyToShip.length;

  return (
    <MerchantPage
      eyebrow="Sales"
      title="Shipments"
      count={ready ? `${ready} ready` : undefined}
      description="Put paid orders on one delivery route. One pickup, many drops."
    >
      <ShipmentsTab
        ordersState={ordersState}
        selection={shipmentSelection}
        onOpenOrders={() => router.push(merchantUrl("/sales"))}
      />
    </MerchantPage>
  );
}
