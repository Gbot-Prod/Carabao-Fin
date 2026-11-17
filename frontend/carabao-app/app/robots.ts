import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { appSurface, helpUrl, hostKind, subdomainMode } from '@/lib/urls';
import { helpSiteOrigin, siteUrl } from '@/lib/seo';

// One file for every deploy and host (documentation/manuals/SUBDOMAINS.md).
// Only the buyer site and the help site are for search engines.

const PRIVATE_PATHS = [
  '/admin',
  '/api',
  '/merchant',
  '/auth',
  '/two-factor',
  '/forgot-password',
  '/reset-password',
  '/email-verified',
  '/cart',
  '/checkout',
  '/confirmation',
  '/order',
  '/orders',
  '/notifications',
  '/profile',
  '/track',
];

const blockAll: MetadataRoute.Robots = { rules: { userAgent: '*', disallow: '/' } };

export default async function robots(): Promise<MetadataRoute.Robots> {
  if (appSurface === 'admin') return blockAll;
  if (appSurface === 'help') {
    const origin = helpSiteOrigin();
    return {
      rules: { userAgent: '*', allow: '/' },
      ...(origin ? { sitemap: new URL('/sitemap.xml', origin).toString() } : {}),
    };
  }

  const kind = subdomainMode ? hostKind((await headers()).get('host')) : 'other';
  if (kind === 'merchant') return blockAll;
  if (kind === 'help') {
    return { rules: { userAgent: '*', allow: '/' }, sitemap: helpUrl('/sitemap.xml') };
  }

  return {
    rules: { userAgent: '*', allow: '/', disallow: PRIVATE_PATHS },
    sitemap: new URL('/sitemap.xml', siteUrl).toString(),
  };
}
