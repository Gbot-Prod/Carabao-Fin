import type { Metadata } from 'next';
import FarmDetailClient from './FarmDetailClient';
import { farmDescription, getPublicFarm, siteUrl } from '@/lib/seo';
import { farmJsonLd, serializeJsonLd } from '@/lib/structured-data';

// Server wrapper: a shared farm link must show the farm name and banner in the
// Facebook / Messenger preview, and crawlers do not run client JavaScript.
// The page itself is still the client component.

type Props = { params: Promise<{ merchantID: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { merchantID } = await params;
  const id = Number(merchantID);
  if (!Number.isInteger(id) || id <= 0) return { title: 'Farm not found · Carabao', robots: { index: false } };

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
  const { merchantID } = await params;
  const id = Number(merchantID);
  // Same cached request as generateMetadata, so no extra API call.
  const farm = Number.isInteger(id) && id > 0 ? await getPublicFarm(id) : null;
  const jsonLd = farm?.merchant
    ? serializeJsonLd(farmJsonLd(farm.merchant, farm.shopPage, new URL(`/farms/${id}`, siteUrl).toString()))
    : null;

  return (
    <>
      {jsonLd ? (
        // CF-0035: structured data for search results. A data block, not
        // script, so CSP does not apply; serializeJsonLd escapes "<".
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      ) : null}
      <FarmDetailClient />
    </>
  );
}
