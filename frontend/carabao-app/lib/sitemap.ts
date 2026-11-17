// CF-0041: sitemap.xml entries. Pure functions, so `npm test` runs them.
//
// Each host lists only its own pages (a sitemap may not name URLs on another
// host): the buyer site lists the home page, the farm list and each public
// farm; the help site lists its four static pages. Farm lastModified comes
// from the farm's `updated_at` (GET /merchants).

export type SitemapFarm = { id: number; updated_at?: string | null };

export type SitemapEntry = {
  url: string;
  lastModified?: Date;
  changeFrequency?: 'daily' | 'weekly' | 'monthly';
  priority?: number;
};

/** Help pages by clean path. Keep in step with app/(help)/help/. */
export const HELP_PATHS = ['/', '/contact', '/terms', '/privacy'] as const;

function validDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Buyer site: home, farm list, then one entry per farm (deduplicated, by id). */
export function buyerSitemap(base: string | URL, farms: readonly SitemapFarm[]): SitemapEntry[] {
  const url = (path: string) => new URL(path, base).toString();
  const byId = new Map<number, SitemapFarm>();
  for (const farm of farms) {
    if (Number.isInteger(farm.id) && farm.id > 0 && !byId.has(farm.id)) byId.set(farm.id, farm);
  }
  const ordered = [...byId.values()].sort((a, b) => a.id - b.id);
  const farmEntries: SitemapEntry[] = ordered.map((farm) => {
    const lastModified = validDate(farm.updated_at);
    return {
      url: url(`/farms/${farm.id}`),
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: 'daily',
      priority: 0.8,
    };
  });
  // The farm list changes when any farm does.
  const newest = farmEntries.reduce<Date | undefined>(
    (max, e) => (e.lastModified && (!max || e.lastModified > max) ? e.lastModified : max),
    undefined,
  );
  return [
    { url: url('/'), changeFrequency: 'daily', priority: 1 },
    { url: url('/farms'), ...(newest ? { lastModified: newest } : {}), changeFrequency: 'daily', priority: 0.9 },
    ...farmEntries,
  ];
}

/**
 * Help pages. `urlFor` maps a clean help path to its absolute URL: on the
 * help host that is the path itself; on a one-host deploy it is `/help/...`.
 */
export function helpSitemap(urlFor: (path: string) => string): SitemapEntry[] {
  return HELP_PATHS.map((path) => ({
    url: urlFor(path),
    changeFrequency: 'monthly',
    priority: path === '/' ? 0.6 : 0.3,
  }));
}
