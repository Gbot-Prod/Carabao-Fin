import { NextResponse, type NextRequest } from "next/server";
import { appSurface, routeRequest } from "@/lib/urls";

// CF-0002: Content-Security-Policy for every page.
//
// Rollout: the policy is sent as Content-Security-Policy-Report-Only, and
// browsers post violations to /api/csp-report. When the reports show no
// real violations, set CSP_ENFORCE=true to send it as an enforced policy.
//
// Scripts are allowed by a per-request nonce. Next.js reads the nonce from
// the CSP request header and puts it on its own <script> tags.

const isDev = process.env.NODE_ENV !== "production";
const enforce = process.env.CSP_ENFORCE === "true";

function origin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const apiOrigin = origin(
  process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_FASTAPI_URL || "http://localhost:8000",
);

const MAPBOX = ["https://api.mapbox.com", "https://*.tiles.mapbox.com", "https://events.mapbox.com"];

// nonce null: a statically rendered page (help). Its HTML is made at build, so
// it has no nonce, and Next.js puts inline scripts in it. Those pages have no
// sign-in and no user data.
const reportsOn = appSurface !== "help";

function buildPolicy(nonce: string | null): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'strict-dynamic' lets the nonced Next.js scripts load their chunks.
    // React needs eval only in development (for its debug tools).
    "script-src": [
      "'self'",
      ...(nonce ? [`'nonce-${nonce}'`, "'strict-dynamic'"] : ["'unsafe-inline'"]),
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    // CSS modules, Mapbox GL and React style={} props use inline styles.
    "style-src": ["'self'", "'unsafe-inline'"],
    // Product photos and avatars come from R2 and Google; map tiles from Mapbox.
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(apiOrigin ? [apiOrigin] : []), ...MAPBOX, ...(isDev ? ["ws:"] : [])],
    // Mapbox GL runs its workers from blob: URLs.
    "worker-src": ["'self'", "blob:"],
    "child-src": ["'self'", "blob:"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "manifest-src": ["'self'"],
    // The help deploy has no /api, so it sends no reports.
    ...(reportsOn ? { "report-uri": ["/api/csp-report"], "report-to": ["csp"] } : {}),
  };
  const parts = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  if (!isDev && enforce) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

// Host routing (documentation/manuals/SUBDOMAINS.md). The rules are in
// lib/urls.ts, where they are tested.
function isPrefetch(request: NextRequest): boolean {
  return request.headers.has("next-router-prefetch") || request.headers.get("purpose") === "prefetch";
}

// Paths that start with "_" are private folders in the app router, so no page
// matches and Next.js renders app/not-found.tsx with status 404.
const NOT_FOUND_PATH = "/_surface-not-found";

export function proxy(request: NextRequest) {
  const decision = routeRequest({
    host: request.headers.get("x-forwarded-host") || request.headers.get("host"),
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
  });

  // API routes (all deploys but help): no page, so no routing and no CSP.
  if (decision.kind === "next" && /^\/api(\/|$)/.test(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  if (decision.kind === "redirect") {
    // A relative location stays on the request host.
    const target = /^https?:\/\//.test(decision.location)
      ? new URL(decision.location)
      : (() => {
          const parsed = new URL(decision.location, "http://same.invalid");
          const url = request.nextUrl.clone();
          url.pathname = parsed.pathname;
          url.search = parsed.search;
          return url;
        })();
    return NextResponse.redirect(target, 307);
  }

  let rewriteTo: URL | null = null;
  if (decision.kind === "rewrite" || decision.kind === "notFound") {
    rewriteTo = request.nextUrl.clone();
    rewriteTo.pathname = decision.kind === "rewrite" ? decision.path : NOT_FOUND_PATH;
  }

  // Prefetches do not render a page, so they need no nonce.
  if (isPrefetch(request)) {
    return rewriteTo ? NextResponse.rewrite(rewriteTo) : NextResponse.next();
  }

  // Help pages are static (app/(help)): no nonce for them.
  const pagePath = rewriteTo ? rewriteTo.pathname : request.nextUrl.pathname;
  const isStaticPage = appSurface === "help" || pagePath === "/help" || pagePath.startsWith("/help/");
  const nonce = isStaticPage ? null : btoa(crypto.randomUUID());
  const policy = buildPolicy(nonce);
  const headerName = enforce ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";

  const requestHeaders = new Headers(request.headers);
  if (nonce) requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(headerName, policy);

  const response = rewriteTo
    ? NextResponse.rewrite(rewriteTo, { request: { headers: requestHeaders } })
    : NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(headerName, policy);
  if (reportsOn) response.headers.set("Reporting-Endpoints", 'csp="/api/csp-report"');
  return response;
}

export const config = {
  // Not framework files. /api comes through so that the help deploy can
  // refuse it (the other deploys pass it on at once). Prefetches come through
  // too: on merchant. and help. they must be rewritten like the page itself.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public).*)"],
};
