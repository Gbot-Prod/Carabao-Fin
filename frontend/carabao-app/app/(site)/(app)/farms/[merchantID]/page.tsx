import type { Metadata } from 'next';
import FarmDetailClient from './FarmDetailClient';
import { farmDescription, getPublicFarm } from '@/lib/seo';

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

export default function FarmPage() {
  return <FarmDetailClient />;
}
