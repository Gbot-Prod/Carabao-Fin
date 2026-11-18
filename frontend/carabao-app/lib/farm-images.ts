// CF-0056 (B59): a farm card's logo and banner come from the `shop_page` that
// GET /merchants already returns, not from one /shoppage request per farm.

type WithShopPage = {
  shop_page?: { logo_url?: string | null; banner_image_url?: string | null } | null;
};

const url = (v: string | null | undefined): string | null =>
  typeof v === 'string' && v.trim() ? v : null;

export function farmImages(merchant: WithShopPage): { logoUrl: string | null; bannerUrl: string | null } {
  const page = merchant.shop_page ?? null;
  return { logoUrl: url(page?.logo_url), bannerUrl: url(page?.banner_image_url) };
}
