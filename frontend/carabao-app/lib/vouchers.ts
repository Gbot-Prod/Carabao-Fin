// Pure helpers for the merchant voucher page (CF-0061). The same rules are
// enforced by the API (schemas/voucher.py, services/vouchers.check_rules);
// these only give the merchant an early, clear message.

import type { Voucher, VoucherInput, VoucherKind } from '../util/api/vouchers.ts';

export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,31}$/;
export const MAX_PERCENT = 90;

export type VoucherDraft = {
  code: string;
  kind: VoucherKind;
  value: string;
  minSubtotal: string;
  maxDiscount: string;
  usageLimit: string;
  perUserLimit: string;
  /** yyyy-mm-dd from a date input, Manila calendar; empty for none. */
  startsOn: string;
  endsOn: string;
};

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
export function describeVoucher(v: Pick<Voucher, 'kind' | 'value' | 'max_discount' | 'min_subtotal'>): string {
  const off =
    v.kind === 'percent'
      ? `${v.value}% off${v.max_discount ? ` (up to ${peso(v.max_discount)})` : ''}`
      : `${peso(v.value)} off`;
  return v.min_subtotal > 0 ? `${off}, min. ${peso(v.min_subtotal)}` : off;
}

export type VoucherStatus = 'off' | 'scheduled' | 'expired' | 'used up' | 'active';

export function voucherStatus(v: Voucher, now: Date = new Date()): VoucherStatus {
  if (!v.active) return 'off';
  if (v.starts_at && new Date(v.starts_at) > now) return 'scheduled';
  if (v.expires_at && new Date(v.expires_at) <= now) return 'expired';
  if (v.usage_limit != null && v.uses >= v.usage_limit) return 'used up';
  return 'active';
}

const wholeNumber = (raw: string): number | null => {
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
};

// Manila is UTC+8 with no DST: a day starts at 00:00+08:00.
const manilaStart = (day: string) => `${day}T00:00:00+08:00`;

/** The API body, or the first problem in words. */
export function draftToInput(d: VoucherDraft): { input: VoucherInput } | { error: string } {
  const code = d.code.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    return { error: 'Code: 3–32 letters, digits or "-", starting with a letter or digit.' };
  }
  const value = wholeNumber(d.value);
  if (value == null || value < 1) return { error: 'Enter the discount as a whole number.' };
  if (d.kind === 'percent' && value > MAX_PERCENT) {
    return { error: `A percent voucher is 1 to ${MAX_PERCENT} %.` };
  }
  const optional = (raw: string, label: string, min: number): number | null | string => {
    if (!raw.trim()) return null;
    const n = wholeNumber(raw);
    return n == null || n < min ? `${label} must be a whole number, ${min} or more.` : n;
  };
  const minSubtotal = optional(d.minSubtotal, 'Minimum spend', 0);
  const maxDiscount = d.kind === 'percent' ? optional(d.maxDiscount, 'Maximum discount', 1) : null;
  const usageLimit = optional(d.usageLimit, 'Total uses', 1);
  const perUser = optional(d.perUserLimit || '1', 'Uses per buyer', 1);
  for (const v of [minSubtotal, maxDiscount, usageLimit, perUser]) {
    if (typeof v === 'string') return { error: v };
  }
  if (d.startsOn && d.endsOn && d.endsOn < d.startsOn) {
    return { error: 'The last day must be on or after the first day.' };
  }
  return {
    input: {
      code,
      kind: d.kind,
      value,
      min_subtotal: (minSubtotal as number | null) ?? 0,
      max_discount: maxDiscount as number | null,
      usage_limit: usageLimit as number | null,
      per_user_limit: perUser as number,
      starts_at: d.startsOn ? manilaStart(d.startsOn) : null,
      // The voucher works through the whole last day (Manila).
      expires_at: d.endsOn ? manilaStart(nextDay(d.endsOn)) : null,
      active: true,
    },
  };
}

function nextDay(day: string): string {
  const [y, m, dd] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd + 1));
  return t.toISOString().slice(0, 10);
}
