import { merchantSignInPath } from "@/lib/urls";

/**
 * The merchant login page, with ?next= set to `next` (a path on this host, as
 * the browser shows it: "/sales" on merchant.<root>, "/merchant/sales" on one
 * host). The dashboard needs no ?next=. Same as lib/urls merchantSignInPath.
 */
export function merchantLoginUrl(next?: string | null): string {
  return merchantSignInPath(next);
}
