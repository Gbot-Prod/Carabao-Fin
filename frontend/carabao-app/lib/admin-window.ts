// CF-0067: the admin payout and application lists load a window at a time.
// Same sizes as backend/app/api/routes/admin.py (ADMIN_LIST_DEFAULT / _MAX).

export const ADMIN_LIST_LIMIT = 200;
export const ADMIN_LIST_MAX = 500;

/** `incoming` added to `existing`, one row per id, first order kept. */
export function mergeById<T extends { id: number }>(existing: T[], incoming: T[]): T[] {
  const seen = new Set(existing.map((row) => row.id));
  return [...existing, ...incoming.filter((row) => !seen.has(row.id))];
}

/** A full window means there may be more rows after it. */
export const mayHaveMore = (received: number, limit: number = ADMIN_LIST_LIMIT) => received >= limit;
