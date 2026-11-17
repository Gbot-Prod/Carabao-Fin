import type { MetadataRoute } from 'next';
import { appSurface } from '@/lib/urls';
import { getPublicFarms, siteUrl } from '@/lib/seo';

// Buyer pages that need no sign-in, plus one entry for each public farm.
// The farm list comes from the public GET /merchants (approved farms only).

// Build the list per request, not at build time: the API is not always
// available during `next build`, and new farms must show without a deploy.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (appSurface !== 'public') return [];

  const url = (path: string) => new URL(path, siteUrl).toString();
  const pages: MetadataRoute.Sitemap = [
    { url: url('/'), changeFrequency: 'daily', priority: 1 },
    { url: url('/farms'), changeFrequency: 'daily', priority: 0.9 },
    { url: url('/terms'), changeFrequency: 'yearly', priority: 0.2 },
    { url: url('/privacy'), changeFrequency: 'yearly', priority: 0.2 },
  ];

  const farms = (await getPublicFarms()) ?? [];
  for (const farm of farms) {
    pages.push({ url: url(`/farms/${farm.id}`), changeFrequency: 'daily', priority: 0.8 });
  }
  return pages;
}
