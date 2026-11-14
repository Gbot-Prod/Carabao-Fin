// Phone numbers and phone-signup accounts, shared by the server (lib/auth.ts)
// and the web client.

// Phone signups get a made-up email because BetterAuth requires one. ".invalid"
// is reserved (RFC 2606), so nothing can ever be delivered to it. Keep in step
// with PLACEHOLDER_EMAIL_DOMAIN in backend/app/models/auth_identity.py.
export const PHONE_PLACEHOLDER_EMAIL_DOMAIN = "phone.carabao.invalid";

export const isPlaceholderEmail = (email: string | null | undefined): boolean =>
  !!email && email.trim().toLowerCase().endsWith(`@${PHONE_PLACEHOLDER_EMAIL_DOMAIN}`);

/** The address to show for an account: none for a phone signup without one. */
export const displayEmail = (email: string | null | undefined): string | null =>
  email && !isPlaceholderEmail(email) ? email : null;

// The one stored form of a number: +63 and a 10-digit mobile number (9XXXXXXXXX).
export const PH_MOBILE_PATTERN = /^\+639\d{9}$/;

/** "0912 345 6789", "912-345-6789", "+63 912…" → "+639123456789"; else null. */
export function normalizePhMobile(value: string): string | null {
  let digits = value.replace(/[\s()-]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("09") && digits.length === 11) digits = `63${digits.slice(1)}`;
  if (digits.startsWith("9") && digits.length === 10) digits = `63${digits}`;
  const normalized = `+${digits}`;
  return PH_MOBILE_PATTERN.test(normalized) ? normalized : null;
}

/** "+639123456789" → "+63 912 345 6789" for display. */
export const formatPhMobile = (value: string | null | undefined): string =>
  value && PH_MOBILE_PATTERN.test(value)
    ? `+63 ${value.slice(3, 6)} ${value.slice(6, 9)} ${value.slice(9)}`
    : value ?? "";
