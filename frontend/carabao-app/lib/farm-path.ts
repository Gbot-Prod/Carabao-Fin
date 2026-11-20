// A farm's public page is /farms/<slug> (e.g. /farms/la-trinidad-highland).
// /farms/<id> still works: the page answers it with a permanent redirect to
// the slug URL, so old links, the mobile app and signed-in pages that only
// know the id keep working. The slug rule matches the API (schemas/shopPage.py):
// lowercase words joined by hyphens, never only digits (that reads as an id).

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG = 80;

export function isFarmSlug(value: string | null | undefined): value is string {
  return !!value && value.length <= MAX_SLUG && SLUG.test(value) && !/^\d+$/.test(value);
}

/** The path to a farm: by slug when it has a usable one, else by id. */
export function farmPath(id: number, slug?: string | null): string {
  return isFarmSlug(slug) ? `/farms/${slug}` : `/farms/${id}`;
}

export type FarmParam = { kind: 'id'; id: number } | { kind: 'slug'; slug: string } | null;

/** Reads the [farm] segment of /farms/[farm]. Null for anything that can name no farm. */
export function parseFarmParam(raw: string): FarmParam {
  let value: string;
  try {
    value = decodeURIComponent(raw).trim();
  } catch {
    return null;
  }
  if (/^\d+$/.test(value)) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? { kind: 'id', id } : null;
  }
  // Case is not part of a slug: /farms/La-Trinidad finds the farm, and the
  // page redirects to the lowercase form.
  const slug = value.toLowerCase();
  return isFarmSlug(slug) ? { kind: 'slug', slug } : null;
}
