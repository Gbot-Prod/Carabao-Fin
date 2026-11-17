// CF-0035: schema.org JSON-LD for public farm pages (Google rich results).
// Pure functions, no imports with runtime code, so `npm test` runs them.
//
// One @graph per farm page: the farm as a LocalBusiness (with AggregateRating
// only when it has reviews), each listed produce item as a Product with an
// Offer sold by that farm, and a BreadcrumbList. Only public fields are used: the street address,
// pin location and contact details are left out on purpose (many farms are
// someone's home).

export type JsonLdProduce = {
  id: number;
  name: string | null;
  description: string | null;
  category: string | null;
  price: number;
  unit: 'kg' | 'lbs';
  unit_quantity: number;
  stock_quantity: number;
  image_url: string | null;
};

export type JsonLdFarm = {
  id: number;
  merchant_name: string;
  city: string | null;
  province: string | null;
  postal_code?: string | null;
  rating: number | null;
  rating_count?: number | null;
  produces?: JsonLdProduce[];
};

export type JsonLdShopPage = {
  title?: string | null;
  description?: string | null;
  banner_image_url?: string | null;
  logo_url?: string | null;
};

// Keeps the page small; Google reads a sample of Products anyway.
export const MAX_PRODUCTS = 30;

// UN/CEFACT codes that schema.org unitCode expects.
const UNIT_CODE: Record<JsonLdProduce['unit'], string> = { kg: 'KGM', lbs: 'LBR' };

/** Absolute http(s) URLs only; anything else is dropped. */
function absoluteUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Drops undefined values so the output has no empty keys. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

export function farmJsonLd(
  farm: JsonLdFarm,
  shopPage: JsonLdShopPage | null,
  pageUrl: string,
): Record<string, unknown> {
  const farmId = `${pageUrl}#farm`;
  const name = clean(shopPage?.title) ?? farm.merchant_name;
  const ratingCount = farm.rating_count ?? 0;

  const business = compact({
    '@type': 'LocalBusiness',
    '@id': farmId,
    name,
    url: pageUrl,
    description: clean(shopPage?.description),
    image: absoluteUrl(shopPage?.banner_image_url) ?? absoluteUrl(shopPage?.logo_url),
    logo: absoluteUrl(shopPage?.logo_url),
    address: compact({
      '@type': 'PostalAddress',
      addressLocality: clean(farm.city),
      addressRegion: clean(farm.province),
      postalCode: clean(farm.postal_code),
      addressCountry: 'PH',
    }),
    aggregateRating:
      farm.rating != null && ratingCount > 0
        ? {
            '@type': 'AggregateRating',
            ratingValue: Math.round(farm.rating * 10) / 10,
            reviewCount: ratingCount,
            bestRating: 5,
            worstRating: 1,
          }
        : undefined,
  });

  const products = (farm.produces ?? [])
    .filter((p) => clean(p.name) && p.price > 0)
    .slice(0, MAX_PRODUCTS)
    .map((p) =>
      compact({
        '@type': 'Product',
        '@id': `${pageUrl}#produce-${p.id}`,
        name: clean(p.name),
        description: clean(p.description),
        category: clean(p.category),
        image: absoluteUrl(p.image_url),
        offers: {
          '@type': 'Offer',
          url: pageUrl,
          price: p.price.toFixed(2),
          priceCurrency: 'PHP',
          availability:
            p.stock_quantity > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: p.price.toFixed(2),
            priceCurrency: 'PHP',
            referenceQuantity: {
              '@type': 'QuantitativeValue',
              value: p.unit_quantity,
              unitCode: UNIT_CODE[p.unit] ?? UNIT_CODE.kg,
            },
          },
          seller: { '@id': farmId },
        },
      }),
    );

  // CF-0041: Home › Farms › this farm, so results show the path, not the bare URL.
  const breadcrumbs = {
    '@type': 'BreadcrumbList',
    '@id': `${pageUrl}#breadcrumbs`,
    itemListElement: [
      { name: 'Home', path: '/' },
      { name: 'Farms', path: '/farms' },
    ]
      .map((crumb, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: crumb.name,
        item: new URL(crumb.path, pageUrl).toString(),
      }))
      // The last crumb is the page itself.
      .concat([{ '@type': 'ListItem', position: 3, name, item: pageUrl }]),
  };

  return { '@context': 'https://schema.org', '@graph': [business, ...products, breadcrumbs] };
}

/**
 * JSON for a <script type="application/ld+json"> body. Farm names and
 * descriptions are merchant-written, so `<`, `>` and `&` are escaped: a value
 * containing `</script>` must not end the tag. U+2028/2029 are escaped too.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
