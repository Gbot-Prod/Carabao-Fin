// S16 (plan §5.11): Store settings, the mobile copy of the web shop page's own cards.
// The rules and words come from the web, so both apps validate and describe a store the same
// way: merchant/components/StoreDetails.tsx (operating days, the delivery fee, the "+63" phone
// box and its code), merchant/lib/format.ts (formatLocalPhone) and
// merchant/components/DangerZone.tsx (the 409 blockers that stop a delete).
// Pure, so `npm test` can read it without React Native; the screen holds the state.

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export type MerchantDay = (typeof DAYS)[number];

// Same limit as the backend (backend/app/schemas/merchant.py MerchantUpdate.delivery_price).
export const MAX_DELIVERY_PRICE = 100_000;

// The web's StoreDetails and HolidayModePanel leave the last day a week from today.
export const DEFAULT_PAUSE_DAYS = 7;

// StorePauseIn.message: Field(default=None, max_length=200).
export const PAUSE_MESSAGE_MAX = 200;

/** Local PH mobile digits → "912 345 6789" (web merchant/lib/format.ts, while typing). */
export function formatLocalPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  const a = digits.slice(0, 3);
  const b = digits.slice(3, 6);
  const c = digits.slice(6, 10);
  return [a, b, c].filter(Boolean).join(' ');
}

/** The phone box's starting text: a stored "+639171234567" shows as "917 123 4567". */
export function localPhoneFromStored(value: string | null | undefined): string {
  return formatLocalPhone((value ?? '').replace(/^\+?63\s?/, ''));
}

/** "Mon, Wed, Fri" in week order; "" when the farm has no days (the web's daysText). */
export const daysText = (days: readonly string[] | null | undefined): string =>
  DAYS.filter((d) => days?.includes(d)).join(', ');

/** The delivery fee box's problem, or null. Blank means no flat fee. */
export function deliveryFeeProblem(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const fee = Number(trimmed);
  if (!Number.isInteger(fee) || fee < 0 || fee > MAX_DELIVERY_PRICE) {
    return `Enter a delivery fee from ₱0 to ₱${MAX_DELIVERY_PRICE.toLocaleString()}, in whole pesos.`;
  }
  return null;
}

/** The operating days' problem, or null (the backend needs at least one day). */
export const daysProblem = (days: readonly string[]): string | null =>
  days.length === 0 ? 'Select at least one operating day.' : null;

/** The code box keeps six digits, as the web input does. */
export const codeInput = (raw: string): string => raw.replace(/\D/g, '').slice(0, 6);

/** True when the six-digit code can be sent for checking. */
export const codeComplete = (code: string): boolean => /^\d{6}$/.test(code);

// The web StoreDetails' own messages for the pieces it checks before the API.
export const PHONE_PROBLEM = 'Enter a Philippine mobile number, e.g. 912 345 6789.';
export const CODE_PROBLEM = 'Send a code to the new contact number and enter it first.';
export const CODE_SENT_HINT = 'We send a code to the new number. You must enter it before you can save.';
export const SAVE_ERROR = 'The store details could not be saved. Try again.';
export const SEND_CODE_ERROR = 'The code could not be sent. Try again.';

// Holiday mode (web HolidayModePanel's words).
export const PAUSE_ERROR = 'Could not pause your store.';
export const RESUME_ERROR = 'Could not resume your store.';

// Danger zone (web DangerZone.tsx).
export const DELETE_START_ERROR = 'Something went wrong. Try again.';
export const DELETE_SEND_ERROR = "We couldn't send the code. Try again.";
export const DELETE_CONFIRM_ERROR = 'The merchant profile could not be deleted. Try again.';
export const DELETE_BLOCKED_MESSAGE = "Your shop can't be deleted yet.";
// The resend timer's key: the code always goes to the account's own number.
export const DELETE_CODE_TARGET = 'merchant-delete';

// The backend's 409 names what is still open (find_deletion_blockers).
export const BLOCKER_LABELS: Record<string, (n: number) => string> = {
  active_orders: (n) => `${n} active order${n === 1 ? '' : 's'} to complete or cancel`,
  pending_payments: (n) => `${n} payment${n === 1 ? '' : 's'} still pending`,
  refunds_pending: (n) => `${n} refund${n === 1 ? '' : 's'} still being processed`,
  unpaid_earnings: (n) => `₱${n.toLocaleString('en-PH')} in earnings not yet paid out to you`,
  open_payouts: (n) => `${n} payout${n === 1 ? '' : 's'} still in progress`,
};

export type DeleteError = { message: string; items: string[] };

/**
 * The 409's detail ({ message, blockers }) as a sentence plus the list of what is still open;
 * anything else as its own words, or `fallback`. `detail` is ApiError.detail (src/lib/api.ts).
 */
export function readDeleteError(err: unknown, fallback: string): DeleteError {
  const { status, message, detail } = (err ?? {}) as {
    status?: number; message?: string; detail?: unknown;
  };
  if (status === 409 && detail && typeof detail === 'object') {
    const { message: detailMessage, blockers } = detail as { message?: unknown; blockers?: unknown };
    const items =
      blockers && typeof blockers === 'object'
        ? Object.entries(blockers as Record<string, number>).map(([key, n]) =>
            BLOCKER_LABELS[key] ? BLOCKER_LABELS[key](n) : `${key.replace(/_/g, ' ')}: ${n}`,
          )
        : [];
    return {
      message: typeof detailMessage === 'string' ? detailMessage : DELETE_BLOCKED_MESSAGE,
      items,
    };
  }
  return { message: message || fallback, items: [] };
}

// ── Store details summary (web StoreDetails' read view) ──────────────────────

/** "Barangay, City, Province, Region", the parts it has; "" when none. */
export function areaText(
  merchant: { barangay?: string | null; city?: string | null; province?: string | null; region?: string | null } | null,
): string {
  return [merchant?.barangay, merchant?.city, merchant?.province, merchant?.region]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(', ');
}

/** "123 Rizal St. · 2600", the parts it has; "" when neither is set. */
export function streetText(merchant: { address?: string | null; postal_code?: string | null } | null): string {
  return [merchant?.address?.trim(), merchant?.postal_code?.trim()].filter(Boolean).join(' · ');
}

/** The pin line: its five decimals (the web's toFixed(5)), marked when unconfirmed. */
export function pinText(
  merchant: { lat?: number | null; lng?: number | null; pin_confirmed?: boolean } | null,
): string {
  if (merchant?.lat == null || merchant?.lng == null) return 'Pin: not pinned';
  const coords = `${merchant.lat.toFixed(5)}, ${merchant.lng.toFixed(5)}`;
  return `Pin: ${coords}${merchant.pin_confirmed ? '' : ' (not confirmed)'}`;
}

/** The field messages an API error carries, as address-form errors (keys match the backend). */
export type SettingsFieldErrors = Partial<
  Record<'region' | 'province' | 'city' | 'barangay' | 'address' | 'postal_code' | 'pin', string>
>;

export const SETTINGS_FIELDS: (keyof SettingsFieldErrors)[] = [
  'region', 'province', 'city', 'barangay', 'address', 'postal_code', 'pin',
];

/** Keeps only the messages for fields the form shows (`ApiError.fieldErrors`). */
export function settingsFieldErrors(fields: Record<string, string>): SettingsFieldErrors {
  const out: SettingsFieldErrors = {};
  for (const key of SETTINGS_FIELDS) {
    if (fields[key]) out[key] = fields[key];
  }
  return out;
}
