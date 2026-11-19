// The backend stores one link for all merchant notifications: "/merchantDashboard".
// The mobile app reads the same value, so it does not change (SUBDOMAINS.md 1.2).
// The web merchant site has one page per section, so the web opens the page
// that the notification kind is about. Unknown kinds open the dashboard.

const PAGE_BY_KIND: Record<string, string> = {
  new_order: "/sales",
  chat_message: "/sales",
  review_received: "/reviews",
  payout_released: "/earnings",
  payout_destination_changed: "/earnings",
};

/**
 * The clean merchant path for a stored merchant link, or null when the link
 * is not the plain "/merchantDashboard" (a link with its own sub-path keeps it).
 */
export function merchantPageForNotification(link: string | null | undefined, kind: string): string | null {
  if (!link) return null;
  const [path] = link.split(/[?#]/);
  if (path !== "/merchantDashboard" && path !== "/merchantDashboard/") return null;
  return PAGE_BY_KIND[kind] ?? "/";
}

/**
 * The clean paths of the merchant site pages (app/(site)/(merchant)/merchant).
 * None may be a buyer path: merchant.<root> sends those to the apex
 * (lib/urls.ts BUYER_PREFIXES). merchant-links.test.ts checks this.
 */
export const MERCHANT_PAGES = {
  dashboard: "/",
  sales: "/sales",
  shipments: "/shipments",
  routing: "/routing",
  earnings: "/earnings",
  reviews: "/reviews",
  produce: "/produce",
  inventory: "/inventory",
  shop: "/shop",
  vouchers: "/vouchers",
  settings: "/settings",
  onboarding: "/onboarding",
  // Same path as the buyer sign-in: each site signs in at /auth.
  login: "/auth",
} as const;
