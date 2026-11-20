import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// CF-0002: headers on every response, including /api and static files.
// The full Content-Security-Policy (with a per-request nonce) is set in
// proxy.ts. frame-ancestors has no effect in a Report-Only policy, so it is
// enforced here as its own policy, together with X-Frame-Options for old
// browsers.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // HSTS only in production: a browser keeps it for two years, and
  // localhost is served over plain http.
  ...(isProd
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains",
        },
      ]
    : []),
];

const rootDomain = process.env.ROOT_DOMAIN || "carabao.online";

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const r2PublicHost = hostOf(process.env.CLOUDFLARE_R2_PUBLIC_URL);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // `npm run dev:admin` runs a second dev server; it needs its own folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Local hosts (carabao.test, merchant.carabao.test, ...): Next.js blocks dev
  // requests from other hosts than localhost unless they are listed.
  allowedDevOrigins: [rootDomain, `*.${rootDomain}`],
  // The admin dev server uses tsconfig.admin.json, so that Next.js writes its
  // .next-admin type paths there and not in tsconfig.json.
  typescript: { tsconfigPath: process.env.NEXT_TSCONFIG_PATH || "tsconfig.json" },
  // lib/urls.ts reads these in client code too. Set at build, like NEXT_PUBLIC_*.
  env: {
    ROOT_DOMAIN: rootDomain,
    APP_SURFACE: process.env.APP_SURFACE === "admin" || process.env.APP_SURFACE === "help" ? process.env.APP_SURFACE : "public",
  },
  // next/image loads only from hosts in this list. Uploaded images (produce,
  // avatars) are on Cloudflare R2: the public r2.dev bucket URL, or a custom
  // domain from CLOUDFLARE_R2_PUBLIC_URL (the same value as in the backend).
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.r2.dev", pathname: "/**" },
      ...(r2PublicHost
        ? [{ protocol: "https" as const, hostname: r2PublicHost, pathname: "/**" }]
        : []),
    ],
  },
  experimental: {
    // Two root layouts (app/(site), app/(help)): unknown URLs use
    // app/global-not-found.tsx.
    globalNotFound: true,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
