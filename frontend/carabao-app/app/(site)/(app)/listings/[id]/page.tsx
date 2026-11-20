import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ListingClient from './ListingClient';
import { getPublicListing, siteUrl } from '@/lib/seo';
import { listingDescription, listingJsonLd, listingTitle, serializeJsonLd } from '@/lib/structured-data';

// CF-0088 (B91): server wrapper, as on the farm page. Crawlers and link
// previews read the first HTML only, so the title, description, canonical URL
// and structured data come from the server. The listing fetched here is also
// handed to the client component (CF-0081), so the first HTML has the name,
// price and farm instead of a spinner.

type Props = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = parseId((await params).id);
  const data = id ? (await getPublicListing(id)).data : null;
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
  // A real 404 (not a 200 "not found" page) so search engines drop a listing
  // that never existed, expired, or belongs to a farm buyers may not see.
  if (!id) notFound();
  // Same cached request as generateMetadata, so no extra API call.
  const result = await getPublicListing(id);
  if (result.missing) notFound();
  // API down or erroring: no 404; the client tries again and shows its error.
  const data = result.data;
  const jsonLd = data
    ? serializeJsonLd(listingJsonLd(data, new URL(`/listings/${id}`, siteUrl).toString()))
    : null;

  return (
    <>
      {jsonLd ? (
        // A data block, not script, so CSP does not apply; serializeJsonLd escapes "<".
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      ) : null}
      {/* key: going from one listing to another remounts with the new data. */}
      <ListingClient key={id} initialData={data} />
    </>
  );
}
