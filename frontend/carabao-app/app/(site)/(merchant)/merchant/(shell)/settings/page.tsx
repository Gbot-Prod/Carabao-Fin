"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import PageLoader from "@/components/PageLoader/PageLoader";
import { MERCHANT_PAGES as P } from "@/lib/merchant-links";
import { merchantUrl } from "@/lib/urls";

// The store settings are now on the shop page. Old links and bookmarks open it.
export default function MerchantSettingsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(merchantUrl(P.shop));
  }, [router]);
  return <PageLoader variant="inline" label="Opening shop & settings…" />;
}
