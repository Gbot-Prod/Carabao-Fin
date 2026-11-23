// CF-0125 / CF-0127 (plan §3.3): the buyer app no longer has the merchant screens, so
// its merchant entry points hand off to Carabao Merchant - the app when it is installed,
// the website otherwise. Pure, for `npm test`.

/** The merchant app's scheme (mobile/CarabaoMerchantMobile/app.json, "scheme"). */
export const MERCHANT_APP_URL = 'carabaomerchant://';

/** dashboard: the merchant screens; onboarding: the form to open a farm. */
export type MerchantHandoffKind = 'dashboard' | 'onboarding';

/** The website page for the hand-off (both redirect to the merchant host, see SUBDOMAINS.md 1.1). */
const WEB_PAGES: Record<MerchantHandoffKind, string> = {
  dashboard: '/merchantDashboard',
  onboarding: '/merchantOnboarding',
};

/** Full URL of the hand-off page on `base` (the checked WEB_BASE). Trailing slashes on base are dropped. */
export function merchantWebUrl(base: string, kind: MerchantHandoffKind): string {
  return `${base.replace(/\/+$/, '')}${WEB_PAGES[kind]}`;
}

/**
 * The path inside the merchant app, the same one its notification links use: `/` for the
 * dashboard, `/onboarding` for the form. A dashboard hand-off that came from a merchant
 * notification opens the screen for its kind (plan §4.5); payouts have no screen yet, and
 * any other kind lands on the dashboard - the kind comes from the server, so it never
 * builds a path of its own.
 */
export function merchantAppPath(kind: MerchantHandoffKind, notificationKind?: string): string {
  if (kind === 'onboarding') return '/onboarding';
  switch (notificationKind) {
    case 'new_order':
      return '/orders';
    case 'chat_message':
      return '/chats';
    case 'review_received':
      return '/reviews';
    default:
      return '/';
  }
}
