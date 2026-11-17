import { MERCHANT_PAGES as P } from "@/lib/merchant-links";
import { merchantUrl } from "@/lib/urls";

/**
 * The merchant login page, with ?next= set to `next` (a path on this host, as
 * the browser shows it: "/sales" on merchant.<root>, "/merchant/sales" on one
 * host). The dashboard needs no ?next=.
 */
export function merchantLoginUrl(next?: string | null): string {
  const base = merchantUrl(P.login);
  const home = merchantUrl("/");
  if (!next || next === "/" || next === home || next === "/merchant") return base;
  return `${base}?next=${encodeURIComponent(next)}`;
}

