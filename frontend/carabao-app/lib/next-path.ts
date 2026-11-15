// Where to go after sign-in (/auth?next=...). Only a path on this site is
// accepted, so a link cannot send a user to another site after sign-in.

const FALLBACK = "/";

export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return FALLBACK;
  // "/x" only: not "//host" or "/\host" (browsers read both as another site),
  // and no control characters or backslashes anywhere.
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(raw)) return FALLBACK;
  try {
    const url = new URL(raw, "http://same.invalid");
    if (url.origin !== "http://same.invalid") return FALLBACK;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return FALLBACK;
  }
}
