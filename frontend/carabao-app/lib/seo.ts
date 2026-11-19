import { cache } from "react";
import type { Merchant, ShopPage } from "@/util/api/merchants";
import { rootDomain } from "@/lib/urls";

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

// Public endpoints only, with no token: the result is the same for every
// viewer, so Next.js can keep it for 5 minutes.
async function getPublic<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${apiBase}${path}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** One request per render, shared by generateMetadata and the page. */
export const getPublicFarm = cache(async (merchantId: number) => {
  const [merchant, shopPage] = await Promise.all([
    getPublic<Merchant>(`/merchants/${merchantId}`),
    getPublic<ShopPage>(`/merchants/${merchantId}/shoppage`),
  ]);
  return { merchant, shopPage };
});

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
