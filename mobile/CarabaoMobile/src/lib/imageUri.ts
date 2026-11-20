// CF-0130: image URLs from the server are shown only when they are plain https links.
// The backend writes them only from its upload routes (CF-0034), so this is a second
// line: an old row, a bad import or a changed API must not make every buyer's phone
// load a file:, content:, data: or cleartext http URL, or a link with user:password@.
// Pure (no React Native imports) so `npm test` covers it. Regex, not `new URL()`
// (see baseUrl.ts).

export const IMAGE_URI_MAX = 2048;

// scheme://host[:port][/path?query] — host without "@", no spaces or control characters.
const IMAGE_URI = /^(https?):\/\/([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:\d{1,5})?([/?][^\s\x5c\x00-\x1f\x7f]*)?$/;

/**
 * The URL to give to <Image source={{ uri }}>, or null (show the placeholder).
 * `allowHttp` is for development builds only (pass `__DEV__`): a local API can serve http.
 */
export function safeImageUri(raw: unknown, allowHttp = false): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > IMAGE_URI_MAX) return null;
  const m = IMAGE_URI.exec(value);
  if (!m) return null;
  if (m[1] !== 'https' && !allowHttp) return null;
  return value;
}
