// Shared with mobile/CarabaoMobile/src/lib/apiErrors.ts. Keep both copies the same (sharedCopies.test.ts).
// CF-0123: read an API error body into one message plus a message per form field,
// so forms can show each problem under its field. Two shapes:
//  - backend FieldErrors (core/errors.py): {"detail": "...", "errors": {field: message}}
//  - FastAPI validation (422): {"detail": [{"loc": ["body", field, ...], "msg": "..."}]}
// Pure, for `npm test`.

export type ParsedError = { message: string | null; fields: Record<string, string> };

const MAX_FIELD = 60;
// Never used as keys: they would change the object instead of adding a field.
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_TEXT = 300;

// Pydantic prefixes custom validator messages with "Value error, ".
const clean = (msg: string) => msg.replace(/^Value error,\s*/i, '').trim().slice(0, MAX_TEXT);

/** The top-level body field a `loc` points at: ["body", "price_tiers", 0, "unit_price"] → "price_tiers". */
function fieldOf(loc: unknown): string | null {
  if (!Array.isArray(loc)) return null;
  const rest = loc[0] === 'body' || loc[0] === 'query' || loc[0] === 'path' ? loc.slice(1) : loc;
  const first = rest.find((p) => typeof p === 'string');
  return typeof first === 'string' && /^[A-Za-z_][\w]{0,59}$/.test(first) && !RESERVED.has(first) ? first : null;
}

export function parseErrorBody(body: unknown): ParsedError {
  const out: ParsedError = { message: null, fields: {} };
  if (!body || typeof body !== 'object') return out;
  const { detail, errors } = body as { detail?: unknown; errors?: unknown };

  if (errors && typeof errors === 'object' && !Array.isArray(errors)) {
    for (const [k, v] of Object.entries(errors as Record<string, unknown>)) {
      if (typeof v === 'string' && k.length <= MAX_FIELD && /^[A-Za-z_][\w.]*$/.test(k) && !RESERVED.has(k)) out.fields[k] = clean(v);
    }
  }
  if (typeof detail === 'string') {
    out.message = detail.slice(0, MAX_TEXT * 3);
  } else if (Array.isArray(detail)) {
    const lines: string[] = [];
    for (const d of detail) {
      if (!d || typeof d !== 'object') continue;
      const { loc, msg } = d as { loc?: unknown; msg?: unknown };
      if (typeof msg !== 'string') continue;
      const text = clean(msg);
      const field = fieldOf(loc);
      if (field && !(field in out.fields)) out.fields[field] = text;
      lines.push(text);
    }
    if (lines.length) out.message = [...new Set(lines)].join('\n');
  }
  return out;
}
