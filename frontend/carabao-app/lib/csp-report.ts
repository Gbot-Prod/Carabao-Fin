// CF-0002 / CF-0090: pure parts of the CSP violation report endpoint
// (app/api/csp-report/route.ts). The endpoint takes posts from anyone, so it
// reads a capped body, logs URLs without query or fragment, and logs at most a
// set number of reports per minute in each server process.

export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_REPORTS_PER_BODY = 10;
export const LOG_BUDGET_PER_MINUTE = 60;

export type CspSummary = { directive?: string; blocked?: string; page?: string };

/**
 * CF-0090: a URL without its query string and fragment. Both can carry personal
 * data or tokens (a magic link, an OAuth fragment), on the page and on the
 * blocked URL. Keywords such as "inline" or "eval" stay as they are.
 */
export function stripQueryAndFragment(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

export function summarizeReports(body: unknown): CspSummary[] {
  const items = Array.isArray(body) ? body : [body];
  return items.slice(0, MAX_REPORTS_PER_BODY).map((item) => {
    const r = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const legacy = r['csp-report'];
    const modern = r['body'];
    const raw = (legacy && typeof legacy === 'object' ? legacy : modern && typeof modern === 'object' ? modern : {}) as Record<
      string,
      unknown
    >;
    const pick = (...keys: string[]) => {
      for (const k of keys) if (typeof raw[k] === 'string') return (raw[k] as string).slice(0, 300);
      return undefined;
    };
    const url = (...keys: string[]) => {
      const value = pick(...keys);
      return value === undefined ? undefined : stripQueryAndFragment(value);
    };
    return {
      directive: pick('effective-directive', 'effectiveDirective', 'violated-directive'),
      blocked: url('blocked-uri', 'blockedURL'),
      page: url('document-uri', 'documentURL'),
    };
  });
}

/**
 * CF-0090: reads at most `maxBytes` of a body stream. Returns null when the body
 * is larger, without reading the rest into memory. A chunked post has no
 * content-length, so checking that header alone does not bound the read.
 */
export async function readCappedText(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string | null> {
  if (!stream) return '';
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/**
 * CF-0090: a fixed-window log budget. `take(n, now)` gives how many of `n`
 * reports may be logged now; the rest are only counted. When a new window
 * starts, `dropped` tells how many were not logged in the window before, so a
 * flood leaves one line instead of filling the logs.
 */
export function createLogBudget(limit: number = LOG_BUDGET_PER_MINUTE, windowMs = 60_000) {
  let windowStart = -Infinity;
  let used = 0;
  let dropped = 0;
  return {
    take(n: number, now: number): { allowed: number; droppedBefore: number } {
      let droppedBefore = 0;
      if (now - windowStart >= windowMs) {
        droppedBefore = dropped;
        windowStart = now;
        used = 0;
        dropped = 0;
      }
      const allowed = Math.max(0, Math.min(n, limit - used));
      used += allowed;
      dropped += n - allowed;
      return { allowed, droppedBefore };
    },
  };
}
