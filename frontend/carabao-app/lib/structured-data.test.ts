// Run with `npm test`. CF-0035.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PRODUCTS, farmJsonLd, serializeJsonLd, type JsonLdFarm, type JsonLdProduce } from './structured-data.ts';

const URL_ = 'https://carabao.example/farms/7';

const tomato: JsonLdProduce = {
  id: 1,
  name: 'Tomato',
  description: 'Vine-ripened',
  category: 'Vegetables',
  price: 80,
  unit: 'kg',
  unit_quantity: 1,
  stock_quantity: 12,
  image_url: 'https://cdn.example/produce/1.webp',
};

const farm: JsonLdFarm = {
  id: 7,
  merchant_name: 'Dela Cruz Farm',
  city: 'Lipa',
  province: 'Batangas',
  postal_code: '4217',
  rating: 4.66,
  rating_count: 12,
  produces: [tomato],
};

// Lets tests walk the nested JSON-LD without casts at each level.
interface Node {
  [key: string]: Node;
}
const graph = (data: Record<string, unknown>) => data['@graph'] as Node[];

test('the farm is a LocalBusiness with a public-only address', () => {
  const [business] = graph(farmJsonLd(farm, null, URL_));
  assert.equal(business['@type'], 'LocalBusiness');
  assert.equal(business['@id'], `${URL_}#farm`);
  assert.equal(business.name, 'Dela Cruz Farm');
  assert.deepEqual(business.address, {
    '@type': 'PostalAddress',
    addressLocality: 'Lipa',
    addressRegion: 'Batangas',
    postalCode: '4217',
    addressCountry: 'PH',
  });
  assert.equal(business.streetAddress, undefined);
  assert.equal(business.telephone, undefined);
});

test('the shop page title, description and banner are used when set', () => {
  const [business] = graph(
    farmJsonLd(farm, { title: ' Lipa Greens ', description: 'Organic', banner_image_url: 'https://cdn.example/b.webp', logo_url: null }, URL_),
  );
  assert.equal(business.name, 'Lipa Greens');
  assert.equal(business.description, 'Organic');
  assert.equal(business.image, 'https://cdn.example/b.webp');
  assert.equal('logo' in business, false);
});

test('a rating is only given with at least one review, rounded to 1 decimal', () => {
  const [rated] = graph(farmJsonLd(farm, null, URL_));
  assert.deepEqual(rated.aggregateRating, {
    '@type': 'AggregateRating',
    ratingValue: 4.7,
    reviewCount: 12,
    bestRating: 5,
    worstRating: 1,
  });
  for (const over of [{ rating: null }, { rating_count: 0 }, { rating_count: undefined }]) {
    const [b] = graph(farmJsonLd({ ...farm, ...over }, null, URL_));
    assert.equal('aggregateRating' in b, false, JSON.stringify(over));
  }
});

test('each listed produce item is a Product with a PHP Offer from the farm', () => {
  const [, product] = graph(farmJsonLd(farm, null, URL_));
  assert.equal(product['@type'], 'Product');
  assert.equal(product.name, 'Tomato');
  assert.equal(product.image, 'https://cdn.example/produce/1.webp');
  assert.equal(product.offers.price, '80.00');
  assert.equal(product.offers.priceCurrency, 'PHP');
  assert.equal(product.offers.availability, 'https://schema.org/InStock');
  assert.deepEqual(product.offers.seller, { '@id': `${URL_}#farm` });
  assert.deepEqual(product.offers.priceSpecification.referenceQuantity, {
    '@type': 'QuantitativeValue',
    value: 1,
    unitCode: 'KGM',
  });
});

test('out of stock, multi-kg units, and unnamed or unpriced items', () => {
  const items: JsonLdProduce[] = [
    { ...tomato, id: 2, stock_quantity: 0, unit: 'kg', unit_quantity: 2 },
    { ...tomato, id: 3, name: '  ' },
    { ...tomato, id: 4, price: 0 },
  ];
  const products = graph(farmJsonLd({ ...farm, produces: items }, null, URL_)).filter(
    (n) => (n['@type'] as unknown) === 'Product',
  );
  assert.equal(products.length, 1);
  assert.equal(products[0].offers.availability, 'https://schema.org/OutOfStock');
  assert.equal(products[0].offers.priceSpecification.referenceQuantity.unitCode, 'KGM');
});

test('products are capped', () => {
  const many = Array.from({ length: MAX_PRODUCTS + 5 }, (_, i) => ({ ...tomato, id: i + 1 }));
  // Farm + products + breadcrumbs.
  assert.equal(graph(farmJsonLd({ ...farm, produces: many }, null, URL_)).length, MAX_PRODUCTS + 2);
});

test('non-http image URLs are dropped', () => {
  for (const bad of ['javascript:alert(1)', '/relative.png', 'data:image/png;base64,AAA', 'not a url']) {
    const [business, product] = graph(
      farmJsonLd({ ...farm, produces: [{ ...tomato, image_url: bad }] }, { banner_image_url: bad }, URL_),
    );
    assert.equal('image' in business, false, bad);
    assert.equal('image' in product, false, bad);
  }
});

test('serialized JSON cannot close the script tag', () => {
  const data = farmJsonLd({ ...farm, merchant_name: '</script><script>alert(1)</script> & co\u2028' }, null, URL_);
  const out = serializeJsonLd(data);
  assert.equal(out.includes('<'), false);
  assert.equal(out.includes('>'), false);
  assert.equal(out.includes('&'), false);
  assert.equal(out.includes('\u2028'), false);
  // Still valid JSON that round-trips to the same value.
  assert.deepEqual(JSON.parse(out), data);
});

test('breadcrumbs go Home > Farms > farm, with absolute URLs (CF-0041)', () => {
  const nodes = graph(farmJsonLd(farm, { title: '  Shop Title ' }, URL_));
  const crumbs = nodes.find((n) => (n['@type'] as unknown) === 'BreadcrumbList') as Node & {
    itemListElement: { position: number; name: string; item: string }[];
  };
  assert.ok(crumbs);
  const origin = new URL(URL_).origin;
  assert.deepEqual(
    crumbs.itemListElement.map((c) => [c.position, c.name, c.item]),
    [
      [1, 'Home', `${origin}/`],
      [2, 'Farms', `${origin}/farms`],
      [3, 'Shop Title', URL_],
    ],
  );
});

// CF-0088 (B91): listing page structured data and preview text.
import { listingDescription, listingJsonLd, listingTitle, type JsonLdListing } from './structured-data.ts';

const LISTING_URL = 'https://carabao.example/listings/1';
const listingData: JsonLdListing = {
  listing: tomato,
  farm: { id: 7, merchant_name: 'Dela Cruz Farm', city: 'Lipa', province: 'Batangas', rating: 4.66, rating_count: 12 },
  other_farms: [
    { id: 9, name: 'Tomato', price: 75, unit: 'kg', stock_quantity: 0, merchant_name: 'Santos Farm' },
    { id: 10, name: 'Tomato', price: 0, unit: 'kg', stock_quantity: 4, merchant_name: 'Free Farm' },
  ],
};

test('listingJsonLd: Product with Offer sold by the farm, similar offers link to their listing pages', () => {
  const nodes = graph(listingJsonLd(listingData, LISTING_URL));
  const product = nodes.find((n) => (n['@type'] as unknown) === 'Product')!;
  assert.equal(product.name, 'Tomato');
  assert.equal(product.url, LISTING_URL);
  assert.equal(product.offers.price, '80.00');
  assert.equal(product.offers.priceCurrency, 'PHP');
  assert.equal(product.offers.availability, 'https://schema.org/InStock');
  assert.deepEqual(product.offers.seller, { '@id': 'https://carabao.example/farms/7#farm' });
  // The zero-price listing is left out; the out-of-stock one is kept and marked.
  assert.equal(product.isSimilarTo.length, 1);
  assert.equal(product.isSimilarTo[0].url, 'https://carabao.example/listings/9');
  assert.equal(product.isSimilarTo[0].offers.availability, 'https://schema.org/OutOfStock');
  assert.equal(product.isSimilarTo[0].offers.seller.name, 'Santos Farm');

  const farmNode = nodes.find((n) => (n['@type'] as unknown) === 'LocalBusiness')!;
  assert.equal(farmNode.url, 'https://carabao.example/farms/7');
  assert.equal(farmNode.aggregateRating.ratingValue, 4.7);
  assert.equal(farmNode.address.streetAddress, undefined);

  const crumbs = nodes.find((n) => (n['@type'] as unknown) === 'BreadcrumbList')!;
  assert.deepEqual(
    (crumbs.itemListElement as unknown as { item: string }[]).map((c) => c.item),
    ['https://carabao.example/', 'https://carabao.example/farms/7', LISTING_URL],
  );
});

test('listingJsonLd: no rating without reviews, no isSimilarTo without other farms', () => {
  const data: JsonLdListing = {
    ...listingData,
    farm: { ...listingData.farm, rating: null, rating_count: 0 },
    other_farms: [],
  };
  const nodes = graph(listingJsonLd(data, LISTING_URL));
  assert.equal(nodes.find((n) => (n['@type'] as unknown) === 'LocalBusiness')!.aggregateRating, undefined);
  assert.equal('isSimilarTo' in nodes.find((n) => (n['@type'] as unknown) === 'Product')!, false);
});

test('listingJsonLd: a merchant-written </script> stays escaped after serializeJsonLd', () => {
  const data: JsonLdListing = { ...listingData, listing: { ...tomato, name: '</script><b>x' } };
  const out = serializeJsonLd(listingJsonLd(data, LISTING_URL));
  assert.equal(out.includes('</script>'), false);
  assert.equal(out.includes('<'), false);
});

test('listingTitle and listingDescription', () => {
  assert.equal(listingTitle(listingData), 'Tomato from Dela Cruz Farm');
  assert.equal(listingDescription(listingData), 'Vine-ripened');
  const plain: JsonLdListing = { ...listingData, listing: { ...tomato, description: null, unit_quantity: 5 } };
  assert.equal(
    listingDescription(plain),
    'Tomato at ₱80.00 per 5 kg from Dela Cruz Farm in Lipa, Batangas. Order on Carabao.',
  );
  const long: JsonLdListing = { ...listingData, listing: { ...tomato, description: 'a'.repeat(300) } };
  assert.equal(listingDescription(long).length, 198);
});

test('listingJsonLd: the seller links to the farm by slug when it has one', () => {
  const data = { ...listingData, farm: { ...listingData.farm, slug: 'dela-cruz-farm' } };
  const nodes = graph(listingJsonLd(data, LISTING_URL));
  const farmNode = nodes.find((n) => (n['@type'] as unknown) === 'LocalBusiness')!;
  assert.equal(farmNode.url, 'https://carabao.example/farms/dela-cruz-farm');
});
