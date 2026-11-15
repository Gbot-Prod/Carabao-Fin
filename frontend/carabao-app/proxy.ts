import { NextResponse, type NextRequest } from "next/server";

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

function buildPolicy(nonce: string): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'strict-dynamic' lets the nonced Next.js scripts load their chunks.
    // React needs eval only in development (for its debug tools).
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
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
    "report-uri": ["/api/csp-report"],
    "report-to": ["csp"],
  };
  const parts = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  if (!isDev && enforce) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const policy = buildPolicy(nonce);
  const headerName = enforce ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(headerName, policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(headerName, policy);
  response.headers.set("Reporting-Endpoints", 'csp="/api/csp-report"');
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|public).*)",
      // Prefetches do not render a page, so they need no nonce.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
