import { cache } from "react";
import type { Merchant, ShopPage } from "@/util/api/merchants";
import type { ListingDetail } from "@/util/api/produceSearch";
import { rootDomain } from "@/lib/urls";
import { parseFarmParam } from "@/lib/farm-path";

// Server-side helpers for metadata, robots.txt and sitemap.xml.
// Crawlers (Facebook, Messenger, Google) read the HTML only, so the farm name
// and banner must be in the first server response.

function toOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim().replace(/^"|"$/g, "");
  if (!trimmed) return null;
  try {
    return new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`).origin;
  } catch {
    return null;
  }
}

/** The buyer site. Open Graph URLs must be absolute, so metadataBase uses this. */
export const siteUrl = new URL(
  toOrigin(process.env.NEXT_PUBLIC_MAIN_URL) ||
    toOrigin(process.env.NEXT_PUBLIC_APP_URL) ||
    "http://localhost:3000",
);

/**
 * The help site's origin, for the help deploy only (CF-0041): NEXT_PUBLIC_HELP_URL,
 * else NEXT_PUBLIC_APP_URL (that deploy's own URL, SUBDOMAINS.md 2.4), else
 * help.<ROOT_DOMAIN>.
 */
export function helpSiteOrigin(): string | null {
  return (
    toOrigin(process.env.NEXT_PUBLIC_HELP_URL) ||
    toOrigin(process.env.NEXT_PUBLIC_APP_URL) ||
    (rootDomain ? toOrigin(`help.${rootDomain}`) : null)
  );
}

const apiBase = toOrigin(process.env.NEXT_PUBLIC_API_URL) || "http://localhost:8000";

/**
 * A read result. ``missing`` is true only when the API answered 404 (no such
 * item, or hidden from buyers). An unreachable API or a 5xx leaves it false,
 * so a page does not answer 404 and drop from search during an outage.
 */
type Fetched<T> = { data: T | null; missing: boolean };

// Public endpoints only, with no token: the result is the same for every
// viewer, so Next.js can keep it for 5 minutes. ``internal`` sends the shared
// secret that skips the per-IP limit (CF-0084): every server render comes from
// our one web server IP. Server only: AUTH_SYNC_SHARED_SECRET has no
// NEXT_PUBLIC_ prefix and no client file imports this module
// (lib/seo-server-only.test.ts checks).
async function fetchPublic<T>(path: string, internal = false): Promise<Fetched<T>> {
  const secret = internal ? process.env.AUTH_SYNC_SHARED_SECRET : undefined;
  try {
    const res = await fetch(`${apiBase}${path}`, {
      headers: secret ? { "X-Internal-Auth-Sync-Secret": secret } : undefined,
      next: { revalidate: 300 },
    });
    if (res.status === 404) return { data: null, missing: true };
    if (!res.ok) return { data: null, missing: false };
    return { data: (await res.json()) as T, missing: false };
  } catch {
    return { data: null, missing: false };
  }
}

async function getPublic<T>(path: string, internal = false): Promise<T | null> {
  return (await fetchPublic<T>(path, internal)).data;
}

/** One request per render, shared by generateMetadata and the page. */
export const getPublicFarm = cache(async (merchantId: number) => {
  const [merchantRes, shopPage] = await Promise.all([
    fetchPublic<Merchant>(`/merchants/${merchantId}`),
    getPublic<ShopPage>(`/merchants/${merchantId}/shoppage`),
  ]);
  return { merchant: merchantRes.data, shopPage, missing: merchantRes.missing };
});

/**
 * Which farm a /farms/[farm] URL names. Takes the raw segment (a string, so
 * React's cache() shares one lookup between generateMetadata and the page).
 * - ``missing``: no such public farm, or the segment can name none (404);
 * - ``merchantId`` null without ``missing``: the API could not answer;
 * - ``slug``: the current slug when the URL used one (by id it is read from
 *   the shop page). The page redirects when the URL is not the canonical one.
 */
export const resolveFarm = cache(
  async (raw: string): Promise<{ merchantId: number | null; slug: string | null; missing: boolean }> => {
    const param = parseFarmParam(raw);
    if (!param) return { merchantId: null, slug: null, missing: true };
    if (param.kind === "id") return { merchantId: param.id, slug: null, missing: false };
    const res = await fetchPublic<{ merchant_id: number; slug: string }>(
      `/shops/${encodeURIComponent(param.slug)}`,
    );
    if (!res.data) return { merchantId: null, slug: null, missing: res.missing };
    return { merchantId: res.data.merchant_id, slug: res.data.slug, missing: false };
  },
);

/**
 * CF-0088 (B91): one listing for the server-rendered /listings/{id} page.
 * GET /produce/{id} has a per-IP limit, so this sends the shared secret.
 */
export const getPublicListing = cache((produceId: number) =>
  fetchPublic<ListingDetail>(`/produce/${produceId}`, true),
);

/**
 * CF-0091 (B96): ids of the listings buyers can order today, for sitemap.xml.
 * Same per-IP limit and shared secret as getPublicListing.
 */
export const getSitemapListingIds = () => getPublic<number[]>("/produce/sitemap-ids", true);

// CF-0062: the sitemap needs ids and dates only, not every listing.
export const getPublicFarms = () => getPublic<Merchant[]>("/merchants?include_produce=false");

/** "Lipa, Batangas" from the parts that are set. */
export function farmLocation(m: Pick<Merchant, "city" | "province">): string {
  return [m.city, m.province].filter(Boolean).join(", ");
}

/** A short preview text: location and up to 5 produce names. Max ~200 characters. */
export function farmDescription(merchant: Merchant, shopPage: ShopPage | null): string {
  const own = shopPage?.description?.trim();
  if (own) return own.length > 200 ? `${own.slice(0, 197)}…` : own;
  const where = farmLocation(merchant);
  const names = Array.from(new Set((merchant.produces ?? []).map((p) => p.name).filter(Boolean))).slice(0, 5);
  const parts = [
    `Order fresh produce from ${merchant.merchant_name}${where ? ` in ${where}` : ""} on Carabao.`,
    names.length ? `Now selling: ${names.join(", ")}.` : "",
  ];
  return parts.filter(Boolean).join(" ");
}
