import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import FarmDetailClient from './FarmDetailClient';
import { farmPath } from '@/lib/farm-path';
import { farmDescription, getPublicFarm, resolveFarm, siteUrl } from '@/lib/seo';
import { farmJsonLd, serializeJsonLd } from '@/lib/structured-data';

// Server wrapper: a shared farm link must show the farm name and banner in the
// Facebook / Messenger preview, and crawlers do not run client JavaScript.
// The farm data fetched here is also handed to the client component, so the
// first HTML already has the name, description and produce (not a spinner).
//
// The URL is /farms/<slug>. /farms/<id>, an old slug (the shop was renamed)
// or another case answer with a permanent (308) redirect to it, so old links
// keep working and pass their search ranking on (lib/farm-path.ts).

type Props = {
  params: Promise<{ farm: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const NOT_FOUND: Metadata = { title: 'Farm not found · Carabao', robots: { index: false } };

/** The farm, its data, and its canonical path; null when there is no such public farm. */
async function loadFarm(raw: string) {
  const found = await resolveFarm(raw);
  if (found.missing) return null;
  if (found.merchantId == null) return { merchantId: null, farm: null, path: null };
  const farm = await getPublicFarm(found.merchantId);
  if (farm.missing) return null;
  // By id the slug comes from the shop page; by slug the lookup gave the current one.
  const slug = found.slug ?? farm.shopPage?.slug ?? null;
  const path = farm.merchant ? farmPath(found.merchantId, slug) : null;
  return { merchantId: found.merchantId, farm, path };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const loaded = await loadFarm((await params).farm);
  const merchant = loaded?.farm?.merchant;
  if (!loaded?.farm || !merchant || !loaded.path) return NOT_FOUND;
  const { shopPage } = loaded.farm;

  const name = shopPage?.title?.trim() || merchant.merchant_name;
  const description = farmDescription(merchant, shopPage);
  const path = loaded.path;
  // No banner: the default image from app/(site)/opengraph-image.tsx stays.
  const images = shopPage?.banner_image_url
    ? [{ url: shopPage.banner_image_url, alt: name }]
    : undefined;

  return {
    title: `${name} · Carabao`,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: 'Carabao',
      locale: 'en_PH',
      url: path,
      title: name,
      description,
      ...(images ? { images } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: name,
      description,
      ...(images ? { images: images.map((i) => i.url) } : {}),
    },
  };
}

function queryString(search: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, v);
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

export default async function FarmPage({ params, searchParams }: Props) {
  const raw = (await params).farm;
  // A real 404 (not a 200 "not found" page) so search engines drop a farm
  // that never existed or was deleted, suspended or unpublished.
  const loaded = await loadFarm(raw);
  if (!loaded) notFound();

  // Not the canonical URL: redirect, keeping the query (e.g. utm_ tags).
  if (loaded.path && loaded.path !== `/farms/${raw}`) {
    permanentRedirect(`${loaded.path}${queryString(await searchParams)}`);
  }

  // API down or erroring: no 404 (the farm may well exist); the client
  // component tries again in the browser and shows its own error. Without the
  // id (a slug the API could not look up) the page can only say so.
  const { merchantId, farm, path } = loaded;
  const jsonLd = farm?.merchant && path
    ? serializeJsonLd(farmJsonLd(farm.merchant, farm.shopPage, new URL(path, siteUrl).toString()))
    : null;

  return (
    <>
      {jsonLd ? (
        // CF-0035: structured data for search results. A data block, not
        // script, so CSP does not apply; serializeJsonLd escapes "<".
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      ) : null}
      {/* key: going from one farm to another remounts, so state starts from the new farm. */}
      <FarmDetailClient
        key={merchantId ?? raw}
        merchantId={merchantId}
        initialMerchant={farm?.merchant ?? null}
        initialShopPage={farm?.shopPage ?? null}
      />
    </>
  );
}
