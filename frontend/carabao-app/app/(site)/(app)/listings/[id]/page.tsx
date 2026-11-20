import type { Metadata } from 'next';
import ListingClient from './ListingClient';
import { getPublicListing, siteUrl } from '@/lib/seo';
import { listingDescription, listingJsonLd, listingTitle, serializeJsonLd } from '@/lib/structured-data';

// CF-0088 (B91): server wrapper, as on the farm page. Crawlers and link
// previews read the first HTML only, so the title, description, canonical URL
// and structured data come from the server. The page itself is the client
// component (CF-0081).

type Props = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = parseId((await params).id);
  const data = id ? await getPublicListing(id) : null;
  if (!id || !data) return { title: 'Listing not found · Carabao', robots: { index: false } };

  const title = listingTitle(data);
  const description = listingDescription(data);
  const path = `/listings/${id}`;
  const image = data.listing.image_url;
  const images = image ? [{ url: image, alt: data.listing.name ?? title }] : undefined;

  return {
    title: `${title} · Carabao`,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: 'Carabao',
      locale: 'en_PH',
      url: path,
      title,
      description,
      ...(images ? { images } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(images ? { images: images.map((i) => i.url) } : {}),
    },
  };
}

export default async function ListingPage({ params }: Props) {
  const id = parseId((await params).id);
  // Same cached request as generateMetadata, so no extra API call.
  const data = id ? await getPublicListing(id) : null;
  const jsonLd = data
    ? serializeJsonLd(listingJsonLd(data, new URL(`/listings/${id}`, siteUrl).toString()))
    : null;

  return (
    <>
      {jsonLd ? (
        // A data block, not script, so CSP does not apply; serializeJsonLd escapes "<".
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      ) : null}
      <ListingClient />
    </>
  );
}
