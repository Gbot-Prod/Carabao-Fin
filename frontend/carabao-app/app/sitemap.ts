import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { appSurface, helpUrl, hostKind, subdomainMode } from '@/lib/urls';
import { getPublicFarms, getSitemapListingIds, helpSiteOrigin, siteUrl } from '@/lib/seo';
import { buyerSitemap, helpSitemap } from '@/lib/sitemap';

// One file for every deploy and host (documentation/manuals/SUBDOMAINS.md).
// Each host lists only its own pages (CF-0041):
// - buyer site: `/`, `/farms`, each public farm (approved farms only, from
//   GET /merchants), each listing buyers can order (CF-0091), plus `/help/*`
//   when one host serves everything;
// - help site (help deploy, or help. on the public deploy): the help pages;
// - merchant and admin hosts: nothing.

// Build the list per request, not at build time: the API is not always
// available during `next build`, and new farms must show without a deploy.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (appSurface === 'admin') return [];
  if (appSurface === 'help') {
    const origin = helpSiteOrigin();
    return origin ? helpSitemap((path) => new URL(path, origin).toString()) : [];
  }

  const kind = subdomainMode ? hostKind((await headers()).get('host')) : 'other';
  if (kind === 'merchant') return [];
  // In subdomain mode helpUrl() is absolute (help.<root>).
  if (kind === 'help') return helpSitemap((path) => helpUrl(path));

  const [farms, listingIds] = await Promise.all([getPublicFarms(), getSitemapListingIds()]);
  const buyer = buyerSitemap(siteUrl, farms ?? [], Array.isArray(listingIds) ? listingIds : []);
  if (subdomainMode) return buyer;
  return [...buyer, ...helpSitemap((path) => new URL(helpUrl(path), siteUrl).toString())];
}
