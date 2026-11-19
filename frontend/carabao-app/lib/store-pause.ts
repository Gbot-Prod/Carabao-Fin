// Holiday mode helpers (CF-0066). The API decides; these only label it.
// Dates are yyyy-mm-dd on the Manila calendar (UTC+8, no DST).

export const MAX_PAUSE_DAYS = 90;

/** Today in Manila as yyyy-mm-dd. */
export function manilaToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** The last paused day when the farm is paused today, else null. */
export function activePause(pausedUntil: string | null | undefined, today: string = manilaToday()): string | null {
  if (!pausedUntil || !/^\d{4}-\d{2}-\d{2}$/.test(pausedUntil)) return null;
  return today <= pausedUntil ? pausedUntil : null;
}

/** "Nov 26" for a yyyy-mm-dd day, read as a calendar day (no time zone shift). */
export function shortDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** An error message for a picked last day, or null when the API will accept it. */
export function pauseDateError(day: string, today: string = manilaToday()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return 'Pick the last day of the break.';
  if (day < today) return 'Pick today or a later day.';
  if (day > addDays(today, MAX_PAUSE_DAYS)) return `A break can last up to ${MAX_PAUSE_DAYS} days.`;
  return null;
}
