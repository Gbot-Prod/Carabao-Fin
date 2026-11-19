// CF-0114: open a payment page only on PayMongo. The URL comes from our API
// (PayMongo's checkout_url), but the app checks it before it opens a browser:
// a wrong or changed value must never send the buyer to another site to "pay".
// Regex, not `new URL()`: React Native's URL class lacks `hostname` on some versions.
// Pure, for `npm test`.

// https://<host>[:443]<path?> where host is paymongo.com or a subdomain of it.
// The authority (before the first / ? #) may not hold "@" (user info) or "\".
const CHECKOUT = /^https:\/\/((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*paymongo\.com)(?::443)?(?:[/?#]|$)/i;

export function isAllowedCheckoutUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 2048 || /\s/.test(url)) return false;
  const authority = url.replace(/^https:\/\//i, '').split(/[/?#]/)[0];
  if (authority.includes('@') || authority.includes('\\')) return false;
  return CHECKOUT.test(url);
}
