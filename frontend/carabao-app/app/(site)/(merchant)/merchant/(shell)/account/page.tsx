"use client";

import ProfileView from "@/app/(site)/(app)/profile/ProfileView";

// The buyer profile page for the merchant site, without delivery addresses.
// Not /profile: that path is a buyer page (lib/urls.ts BUYER_PREFIXES).
export default function MerchantAccountPage() {
  return <ProfileView merchant />;
}
