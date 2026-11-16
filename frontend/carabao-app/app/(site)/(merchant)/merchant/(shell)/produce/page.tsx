"use client";

import { useMerchant } from "../../MerchantContext";
import MerchantPage from "../../MerchantPage";
import ProduceTab from "../../components/ProduceTab";

export default function MerchantProducePage() {
  const { produces, setProduces, produceLoading } = useMerchant();
  return (
    <MerchantPage
      eyebrow="Store"
      title="Produce"
      count={produces.length}
      description="Add, change and remove the produce that buyers can order."
    >
      <ProduceTab produces={produces} setProduces={setProduces} loading={produceLoading} />
    </MerchantPage>
  );
}
