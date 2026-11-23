// Merchant app upload rules (plan §3 "Uploads", section S2). Pure, so `npm test` covers
// them; inStep.test.ts keeps the values equal to the web and backend files.
//
// Sources:
// - image types: web merchant/components/ProduceTab.tsx photo input;
// - image size: backend services/upload_validation.py IMAGE_MAX_BYTES;
// - documents: web merchant/onboarding/DocumentDropzone.tsx DOCUMENT_TYPES and
//   DOCUMENT_MAX_BYTES, with the same words documentError shows;
// - body limits: backend core/body_limit.py (SYSTEM_REFERENCE.md 7.4).

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const DOCUMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

// The backend decodes and re-encodes images up to 5 MB (upload_validation.py).
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
// Web DocumentDropzone.tsx DOCUMENT_MAX_BYTES.
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
// Backend core/body_limit.py DEFAULT_MAX_BODY and PATH_LIMITS["/merchant-onboarding/me"].
export const BODY_LIMIT_BYTES = 12 * 1024 * 1024;
export const ONBOARDING_BODY_LIMIT_BYTES = 42 * 1024 * 1024;

/** A picked file. Some pickers leave the size or the type out. */
export type FileInfo = {
  size?: number | null;
  mimeType?: string | null;
};

/** An error message for an image the picker returned, or null. */
export function checkImage({ size, mimeType }: FileInfo): string | null {
  if (!mimeType || !IMAGE_TYPES.includes(mimeType)) return 'The image must be a PNG, JPG or WebP.';
  if (typeof size === 'number' && size > IMAGE_MAX_BYTES) return 'The image must be 5MB or smaller.';
  return null;
}

/** An error message for an onboarding document, or null. Same words as the web form. */
export function checkDocument(label: string, { size, mimeType }: FileInfo): string | null {
  if (!mimeType || !DOCUMENT_TYPES.includes(mimeType)) {
    return `${label} must be a PDF or an image (PNG/JPG/WEBP).`;
  }
  if (typeof size === 'number' && size > DOCUMENT_MAX_BYTES) {
    return `${label} must be 10MB or smaller.`;
  }
  return null;
}

/** The file shape React Native's FormData takes. */
export type FilePart = { uri: string; name: string; type: string };

/**
 * A file part for FormData. expo-document-picker and expo-image-picker can leave the
 * name or the type empty, so use the last part of the URI and a generic type; the
 * server checks the bytes and never trusts either (services/upload_validation.py).
 */
export function filePart(uri: string, name?: string | null, type?: string | null): FilePart {
  const fromUri = uri.split(/[\\/]/).pop()?.split(/[?#]/)[0] ?? '';
  return {
    uri,
    name: name?.trim() || fromUri || 'upload',
    type: type?.trim() || 'application/octet-stream',
  };
}

/**
 * The Content-Type for a request body: JSON only for a string. A FormData body (or a
 * Blob/URLSearchParams) must go without one, because fetch writes the multipart
 * boundary itself and a JSON header would make the server parse nothing.
 */
export function contentTypeFor(body: unknown): 'application/json' | null {
  return typeof body === 'string' ? 'application/json' : null;
}
