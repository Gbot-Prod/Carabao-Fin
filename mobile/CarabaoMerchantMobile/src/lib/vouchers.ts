// src/lib/vouchers.ts
// S15 (plan §5.10): the farm's voucher codes — the checks the create form runs, the labels the
// list shows and the API body it sends. Pure, for `npm test`.
// The rules, limits and words are the web merchant lib/vouchers.ts
// (frontend/carabao-app/lib/vouchers.ts), which the API checks again for every field
// (backend app/schemas/voucher.py, services/vouchers.check_rules). The server works out the
// discount itself at checkout, so nothing here is trusted by it: these only give the merchant an
// early, clear message.
import type { ApiVoucher, VoucherCreatePayload, VoucherKind } from './api.ts';
import { parseYmd } from './listingForm.ts';

// Same as backend services/vouchers.CODE_PATTERN, after upper-casing (schemas/voucher.py takes
// the code in either case and trims it).
export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,31}$/;
export const MAX_PERCENT = 90;
// The web's maxLength on the code box (its input stops at 32 before the pattern is checked).
export const CODE_MAX_LENGTH = 32;

/** The web's words for a code it cannot take (lib/vouchers.ts draftToInput). */
export const CODE_MESSAGE = 'Code: 3–32 letters, digits or "-", starting with a letter or digit.';

/** What the merchant has typed in the create form, one string per box. */
export type VoucherDraft = {
  code: string;
  kind: VoucherKind;
  value: string;
  minSubtotal: string;
  maxDiscount: string;
  usageLimit: string;
  perUserLimit: string;
  /** A day typed as YYYY-MM-DD on the Manila calendar; empty for none. */
  startsOn: string;
  endsOn: string;
};

/** A new form: percent off, one use per buyer (the backend's defaults too). */
export const EMPTY_DRAFT: VoucherDraft = {
  code: '',
  kind: 'percent',
  value: '',
  minSubtotal: '',
  maxDiscount: '',
  usageLimit: '',
  perUserLimit: '1',
  startsOn: '',
  endsOn: '',
};

const peso = (n: number) => `₱${n.toLocaleString('en-PH')}`;

/** "10% off (up to ₱50)" or "₱100 off", plus the minimum spend. */
export function describeVoucher(
  v: Pick<ApiVoucher, 'kind' | 'value' | 'max_discount' | 'min_subtotal'>,
): string {
  const off =
    v.kind === 'percent'
      ? `${v.value}% off${v.max_discount ? ` (up to ${peso(v.max_discount)})` : ''}`
      : `${peso(v.value)} off`;
  return v.min_subtotal > 0 ? `${off}, min. ${peso(v.min_subtotal)}` : off;
}

/** The web's Status column: why a code is or is not taking orders right now. */
export type VoucherStatus = 'off' | 'scheduled' | 'expired' | 'used up' | 'active';

export function voucherStatus(v: ApiVoucher, now: Date = new Date()): VoucherStatus {
  if (!v.active) return 'off';
  if (v.starts_at && new Date(v.starts_at) > now) return 'scheduled';
  if (v.expires_at && new Date(v.expires_at) <= now) return 'expired';
  if (v.usage_limit != null && v.uses >= v.usage_limit) return 'used up';
  return 'active';
}

/** expires_at is the first moment the code stops working; show the day before. */
export function lastDay(expiresAt: string): string {
  return new Date(Date.parse(expiresAt) - 1).toISOString();
}

/** The web's Uses column: "3 / 100 (2 per buyer)". */
export function usesLabel(v: Pick<ApiVoucher, 'uses' | 'usage_limit' | 'per_user_limit'>): string {
  const cap = v.usage_limit != null ? ` / ${v.usage_limit}` : '';
  const perBuyer = v.per_user_limit > 1 ? ` (${v.per_user_limit} per buyer)` : '';
  return `${v.uses}${cap}${perBuyer}`;
}

/**
 * CF-0061: only a code no order used can be deleted. A redemption is the record of the discount
 * an order got, so the web shows Delete on `uses === 0` rows only, and the server answers 409
 * with its own words for the rest — turning the code off takes it out of checkout all the same.
 */
export function canDelete(v: Pick<ApiVoucher, 'uses'>): boolean {
  return v.uses === 0;
}

/** The web's confirm text (lib/i18n/strings/en.ts merchantConfirm.deleteVoucher). */
export function deleteConfirmText(code: string): string {
  return `Delete voucher ${code}?`;
}


const wholeNumber = (raw: string): number | null => {
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
};

// Manila is UTC+8 with no DST: a day starts at 00:00+08:00.
const manilaStart = (day: string) => `${day}T00:00:00+08:00`;

function nextDay(day: string): string {
  const [y, m, dd] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10);
}

/** The form's boxes, so each message can show under its own box (plan rule 8). */
export type VoucherField =
  | 'code' | 'value' | 'minSubtotal' | 'maxDiscount' | 'usageLimit' | 'perUserLimit'
  | 'startsOn' | 'endsOn';

/** One message under each of the form's boxes. */
export type VoucherFieldErrors = Partial<Record<VoucherField, string>>;

// The web's order of the checks (draftToInput), which is also the order of its messages.
const FIELD_ORDER: VoucherField[] = [
  'code', 'value', 'minSubtotal', 'maxDiscount', 'usageLimit', 'perUserLimit', 'startsOn', 'endsOn',
];

/**
 * Every problem in the draft, in the web's words (lib/vouchers.ts draftToInput).
 * One addition: the web's date inputs can only give a real day and a phone's text box cannot,
 * so the two days are checked here ("2026-02-30" would otherwise reach the server).
 */
export function checkVoucherDraft(d: VoucherDraft): VoucherFieldErrors {
  const errors: VoucherFieldErrors = {};

  const code = d.code.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) errors.code = CODE_MESSAGE;

  const value = wholeNumber(d.value);
  if (value == null || value < 1) {
    errors.value = 'Enter the discount as a whole number.';
  } else if (d.kind === 'percent' && value > MAX_PERCENT) {
    errors.value = `A percent voucher is 1 to ${MAX_PERCENT} %.`;
  }

  // Each optional amount: blank is fine, anything else must be a whole number of at least min.
  const amount = (raw: string, label: string, min: number): string | null => {
    if (!raw.trim()) return null;
    const n = wholeNumber(raw);
    return n == null || n < min ? `${label} must be a whole number, ${min} or more.` : null;
  };
  const minSubtotal = amount(d.minSubtotal, 'Minimum spend', 0);
  // A cap belongs to a percent voucher; the web sends none for a fixed one either.
  const maxDiscount = d.kind === 'percent' ? amount(d.maxDiscount, 'Maximum discount', 1) : null;
  const usageLimit = amount(d.usageLimit, 'Total uses', 1);
  const perUser = amount(d.perUserLimit || '1', 'Uses per buyer', 1);
  if (minSubtotal) errors.minSubtotal = minSubtotal;
  if (maxDiscount) errors.maxDiscount = maxDiscount;
  if (usageLimit) errors.usageLimit = usageLimit;
  if (perUser) errors.perUserLimit = perUser;

  const starts = parseYmd(d.startsOn);
  const ends = parseYmd(d.endsOn);
  if (d.startsOn.trim() && starts === null) {
    errors.startsOn = 'The first day must be a real date, like 2026-12-31.';
  }
  if (d.endsOn.trim() && ends === null) {
    errors.endsOn = 'The last day must be a real date, like 2026-12-31.';
  }
  // The web's order check; YYYY-MM-DD days compare as dates.
  if (!errors.endsOn && starts !== null && ends !== null && ends < starts) {
    errors.endsOn = 'The last day must be on or after the first day.';
  }

  return errors;
}

/** The first problem in the web's order, or null when the draft is fine. */
export function firstVoucherError(errors: VoucherFieldErrors): string | null {
  for (const field of FIELD_ORDER) {
    const message = errors[field];
    if (message) return message;
  }
  return null;
}

/**
 * The API body for a draft checkVoucherDraft passed (backend VoucherCreate), exactly as the web
 * sends it: the code upper-cased, whole pesos, and a last day that works through the whole day
 * in Manila. A new code is on at once, as the web's is.
 */
export function buildVoucherInput(d: VoucherDraft): VoucherCreatePayload {
  const whole = (raw: string): number | null => (raw.trim() ? wholeNumber(raw) : null);
  return {
    code: d.code.trim().toUpperCase(),
    kind: d.kind,
    value: wholeNumber(d.value) as number,
    min_subtotal: whole(d.minSubtotal) ?? 0,
    max_discount: d.kind === 'percent' ? whole(d.maxDiscount) : null,
    usage_limit: whole(d.usageLimit),
    per_user_limit: whole(d.perUserLimit || '1') as number,
    starts_at: d.startsOn.trim() ? manilaStart(d.startsOn.trim()) : null,
    expires_at: d.endsOn.trim() ? manilaStart(nextDay(d.endsOn.trim())) : null,
    active: true,
  };
}

/** The web's draftToInput: the API body, or the first problem in words. */
export function draftToInput(d: VoucherDraft): { input: VoucherCreatePayload } | { error: string } {
  const error = firstVoucherError(checkVoucherDraft(d));
  return error ? { error } : { input: buildVoucherInput(d) };
}

// ── S15: server messages on the form's boxes (plan rule 8) ─────────────────────

// The backend names (schemas/voucher.py) -> the box that shows the message. `kind` has no box
// of its own (the two chips always hold a valid type), so its message would go to the top.
const SERVER_FIELDS: Record<string, VoucherField> = {
  code: 'code',
  value: 'value',
  min_subtotal: 'minSubtotal',
  max_discount: 'maxDiscount',
  usage_limit: 'usageLimit',
  per_user_limit: 'perUserLimit',
  starts_at: 'startsOn',
  expires_at: 'endsOn',
};

export type VoucherSaveErrors = {
  /** Messages for the boxes the form has; each shows under its box. */
  fields: VoucherFieldErrors;
  /** Shown at the top: a network/5xx message, or a server field the form has no box for. */
  top: string | null;
};

/** Rule 8, as listingForm.ts listingSaveErrors does it for a listing's fields. */
export function voucherSaveErrors(
  message: string | null | undefined,
  serverFields: Record<string, string> = {},
): VoucherSaveErrors {
  const fields: VoucherFieldErrors = {};
  const unplaced: string[] = [];
  for (const [key, raw] of Object.entries(serverFields)) {
    const text = raw.trim();
    if (!text) continue;
    const field = SERVER_FIELDS[key];
    if (!field) {
      if (!unplaced.includes(text)) unplaced.push(text);
      continue;
    }
    const shown = fields[field];
    fields[field] = shown && shown !== text ? `${shown} ${text}` : text;
  }
  const placed = Object.keys(fields).length > 0;
  const top = unplaced.length ? unplaced.join('\n') : placed ? null : message?.trim() || null;
  return { fields, top };
}
