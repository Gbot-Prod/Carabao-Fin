// src/lib/dates.ts
// Date helpers both apps need: the buyer's checkout (delivery-date chips) and the
// merchant's listing form (harvest / best-before dates). Philippine time, like the
// backend's ph_today. Pure, for `npm test`.

const PH_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Today's date in the Philippines as YYYY-MM-DD (backend ph_today). */
export function phToday(now: Date = new Date()): string {
  return new Date(now.getTime() + PH_OFFSET_MS).toISOString().slice(0, 10);
}

/** YYYY-MM-DD plus n days (n may be negative). */
export function addDays(ymd: string, n: number): string {
  const [y, mo, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}
