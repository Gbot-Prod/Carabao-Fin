import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import FarmDetailClient from './FarmDetailClient';
import { farmDescription, getPublicFarm, siteUrl } from '@/lib/seo';
import { farmJsonLd, serializeJsonLd } from '@/lib/structured-data';

// Server wrapper: a shared farm link must show the farm name and banner in the
// Facebook / Messenger preview, and crawlers do not run client JavaScript.
// The farm data fetched here is also handed to the client component, so the
// first HTML already has the name, description and produce (not a spinner).

type Props = { params: Promise<{ merchantID: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = parseId((await params).merchantID);
  if (!id) return { title: 'Farm not found · Carabao', robots: { index: false } };

  const { merchant, shopPage } = await getPublicFarm(id);
  if (!merchant) return { title: 'Farm not found · Carabao', robots: { index: false } };

  const name = shopPage?.title?.trim() || merchant.merchant_name;
  const description = farmDescription(merchant, shopPage);
  const path = `/farms/${id}`;
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

export default async function FarmPage({ params }: Props) {
  const id = parseId((await params).merchantID);
  // A real 404 (not a 200 "not found" page) so search engines drop a farm
  // that never existed or was deleted, suspended or unpublished.
  if (!id) notFound();

  // Same cached request as generateMetadata, so no extra API call.
  const farm = await getPublicFarm(id);
  if (farm.missing) notFound();

  // API down or erroring: no 404 (the farm may well exist); the client
  // component tries again in the browser and shows its own error.
  const jsonLd = farm.merchant
    ? serializeJsonLd(farmJsonLd(farm.merchant, farm.shopPage, new URL(`/farms/${id}`, siteUrl).toString()))
    : null;

  return (
    <>
      {jsonLd ? (
        // CF-0035: structured data for search results. A data block, not
        // script, so CSP does not apply; serializeJsonLd escapes "<".
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      ) : null}
      {/* key: going from one farm to another remounts, so state starts from the new farm. */}
      <FarmDetailClient key={id} initialMerchant={farm.merchant} initialShopPage={farm.shopPage} />
    </>
  );
}
