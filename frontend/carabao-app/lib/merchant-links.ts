// The backend stores one link for all merchant notifications: "/merchantDashboard".
// The mobile app reads the same value, so it does not change (SUBDOMAINS.md 1.2).
// The web merchant site has one page per section, so the web opens the page
// that the notification kind is about. Unknown kinds open the dashboard.

const PAGE_BY_KIND: Record<string, string> = {
  new_order: "/sales",
  chat_message: "/chats",
  review_received: "/reviews",
  payout_released: "/earnings",
  payout_destination_changed: "/earnings",
  // Guardrails Phase 1: an admin approved or rejected a listing.
  listing_approved: "/produce",
  listing_rejected: "/produce",
  // Guardrails Phase 2: penalty points (services/listing_trust.py).
  listing_blocked: "/produce",
  listing_penalty_revoked: "/produce",
  // Submit later: "finish your business information" (backend setup_reminders.py).
  setup_reminder: "/onboarding?step=business",
};

/**
 * The clean merchant path for a stored merchant link, or null when the link
 * is not the plain "/merchantDashboard" (a link with its own sub-path keeps it).
 */
export function merchantPageForNotification(link: string | null | undefined, kind: string): string | null {
  if (!link) return null;
  const [path] = link.split(/[?#]/);
  if (path !== "/merchantDashboard" && path !== "/merchantDashboard/") return null;
  const page = PAGE_BY_KIND[kind] ?? "/";
  // A chat message names its thread ("?order=12" or "?inquiry=3"): open it.
  if (kind === "chat_message") {
    const query = new URLSearchParams(link.split("?")[1]?.split("#")[0] ?? "");
    const order = positiveId(query.get("order"));
    if (order) return `${page}?order=${order}`;
    const inquiry = positiveId(query.get("inquiry"));
    if (inquiry) return `${page}?inquiry=${inquiry}`;
  }
  return page;
}

/** A link's id only when it is a plain positive integer. */
export function positiveId(value: string | null | undefined): number | null {
  return value && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : null;
}

/**
 * The clean paths of the merchant site pages (app/(site)/(merchant)/merchant).
 * None may be a buyer path: merchant.<root> sends those to the apex
 * (lib/urls.ts BUYER_PREFIXES). merchant-links.test.ts checks this.
 */
export const MERCHANT_PAGES = {
  dashboard: "/",
  sales: "/sales",
  chats: "/chats",
  shipments: "/shipments",
  routing: "/routing",
  earnings: "/earnings",
  reviews: "/reviews",
  produce: "/produce",
  inventory: "/inventory",
  // The shop page and the store settings are one page (the old /settings
  // path opens it).
  shop: "/shop",
  vouchers: "/vouchers",
  onboarding: "/onboarding",
  // Same path as the buyer sign-in: each site signs in at /auth.
  login: "/auth",
} as const;
