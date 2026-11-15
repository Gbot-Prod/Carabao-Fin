// Phone numbers. Same rules as the web's lib/phone.ts. (Emails come from the
// backend, which already returns null for a phone signup's placeholder.)

// The one stored form of a number: +63 and a 10-digit mobile number (9XXXXXXXXX).
export const PH_MOBILE_PATTERN = /^\+639\d{9}$/;

/** "0912 345 6789", "912-345-6789", "+63 912…" → "+639123456789"; else null. */
export function normalizePhMobile(value: string): string | null {
  let digits = value.replace(/[\s()-]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('09') && digits.length === 11) digits = `63${digits.slice(1)}`;
  if (digits.startsWith('9') && digits.length === 10) digits = `63${digits}`;
  const normalized = `+${digits}`;
  return PH_MOBILE_PATTERN.test(normalized) ? normalized : null;
}

/** "+639123456789" → "+63 912 345 6789" for display. */
export const formatPhMobile = (value: string | null | undefined): string =>
  value && PH_MOBILE_PATTERN.test(value)
    ? `+63 ${value.slice(3, 6)} ${value.slice(6, 9)} ${value.slice(9)}`
    : value ?? '';

export const PHONE_HINT = 'Enter a Philippine mobile number, e.g. 0912 345 6789.';
