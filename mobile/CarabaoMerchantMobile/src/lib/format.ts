// src/lib/format.ts
// Pure text helpers. `ratingLabel` is the Merchant copy of
// mobile/CarabaoMobile/src/lib/farms.ts (CF-0111: the farm card, from GET /merchants,
// which replaced the type that lived in the old mockData.ts). The money and date
// helpers are the web merchant lib/format.ts (`M/lib/format.ts`), so the Orders tab
// (S4) prints the same text as the dashboard. Pure, for `npm test`.

/** "4.5" for a rated farm, "New" for a farm without reviews (not "0"). */
export function ratingLabel(rating: number | null | undefined): string {
  return typeof rating === 'number' && Number.isFinite(rating) && rating > 0 ? rating.toFixed(1) : 'New';
}

/** "₱1,234": pesos with no cents, as the web merchant pages show amounts. */
export const formatPeso = (v: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(v);

/** "Nov 24, 2026" for a timestamp; "—" when there is none, the raw text if unreadable. */
export const formatDate = (v?: string | null) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? v
    : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit' });
};

// "YYYY-MM-DD" → "Tue, Nov 24, 2026", read as a calendar date so no timezone shifts
// the day (the web's requested-delivery date).
export const formatRequestedDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime())
    ? ymd
    : date.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};
