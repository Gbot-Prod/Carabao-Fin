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

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
