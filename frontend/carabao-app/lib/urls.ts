// Hosts and cross-surface links (documentation/manuals/SUBDOMAINS.md).
//
//   <root>            buyer app            (APP_SURFACE=public)
//   merchant.<root>   /merchant/* as clean URLs (same deploy)
//   help.<root>       /help/* as clean URLs     (same deploy)
//   admin.<root>      /admin/* only        (APP_SURFACE=admin, own deploy)
//   help.<root>       /help/* only         (APP_SURFACE=help, own static deploy;
//                     the public deploy can serve it too)
//
// Hosts come from env only. When NEXT_PUBLIC_APP_URL is not on ROOT_DOMAIN
// (localhost, a Railway domain), the site runs on one host: links stay
// relative, as /merchant/... and /help/..., and no host redirects happen.
//
// No imports: proxy.ts, client components and node --test all load this file.

export type AppSurface = "public" | "admin" | "help";
export type HostKind = "apex" | "merchant" | "help" | "other";

export type SurfaceConfig = {
  rootDomain: string;
  appSurface: AppSurface;
  appUrl?: string;
  /** The main (buyer) site, when this deploy is on another host (help deploy). */
  mainUrl?: string;
  merchantUrl?: string;
  helpUrl?: string;
  adminUrl?: string;
};

export type RouteDecision =
  | { kind: "next" }
  | { kind: "rewrite"; path: string }
  // A relative location is resolved against the request URL.
  | { kind: "redirect"; location: string }
  | { kind: "notFound" };

// Paths every host of the public deploy serves as they are (sign-in pages).
const SHARED_PREFIXES = ["/auth", "/forgot-password", "/reset-password", "/email-verified", "/two-factor"];
// Buyer pages. On merchant. or help. they redirect to the apex.
const BUYER_PREFIXES = [
  "/order",
  "/orders",
  "/saved",
  "/notifications",
  "/cart",
  "/checkout",
  "/confirmation",
  "/profile",
  "/track",
  "/landing",
  "/farms",
  // CF-0081: one listing and other farms selling it.
  "/listings",
];
// Pages that moved from the apex to help.<root>. The old apex URLs redirect
// there (sign-up links, bookmarks, search results).
const MOVED_TO_HELP = ["/terms", "/privacy"];
// R2: paths the admin deploy serves as they are. /api and /_next are not in
// the proxy matcher, so they never get here.
const ADMIN_PASS_PREFIXES = ["/api", "/two-factor", "/reset-password", "/forgot-password"];

function origin(value: string | undefined): string | null {
  const trimmed = value?.trim().replace(/^"|"$/g, "");
  if (!trimmed) return null;
  try {
    return new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`).origin;
  } catch {
    return null;
  }
}

/** "/merchant/x" with prefix "/merchant" -> "/x"; null when the prefix does not match. */
function stripPrefix(pathname: string, prefix: string): string | null {
  if (pathname === prefix) return "/";
  if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  return null;
}

function hasPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => stripPrefix(pathname, p) !== null);
}

function join(base: string, path: string): string {
  return path === "/" ? base : `${base}${path}`;
}

/**
 * A file in public/ or an app icon: a dotted name at the top level
 * ("/icon.png", "/robots.txt") or anything under /images/. Not any path whose
 * last segment has a dot: a dynamic page such as "/farms/1.x" would then skip
 * the host rules and render on the admin host.
 */
function isAsset(pathname: string): boolean {
  if (pathname.startsWith("/images/")) return true;
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  return pathname.lastIndexOf("/") === 0 && last.includes(".");
}

export function makeSurfaces(config: SurfaceConfig) {
  const root = config.rootDomain.trim().toLowerCase();
  // Links to buyer pages go to the main site. On the public deploy that is its
  // own URL; the help deploy sets NEXT_PUBLIC_MAIN_URL.
  const appOrigin = origin(config.mainUrl) || origin(config.appUrl);
  const appBase = appOrigin ? new URL(appOrigin) : null;
  // Subdomain links only when the app URL itself is on the root domain.
  const subdomainMode = Boolean(appBase && root && appBase.hostname === root);

  const subOrigin = (explicit: string | undefined, label: string): string | null => {
    const fromEnv = origin(explicit);
    if (fromEnv) return fromEnv;
    if (!subdomainMode || !appBase) return null;
    return `${appBase.protocol}//${label}.${root}${appBase.port ? `:${appBase.port}` : ""}`;
  };
  const merchantOrigin = subOrigin(config.merchantUrl, "merchant");
  const helpOrigin = subOrigin(config.helpUrl, "help");
  const adminOrigin = subOrigin(config.adminUrl, "admin");

  /** A buyer page. */
  const appUrl = (path = "/"): string => (subdomainMode && appOrigin ? `${appOrigin}${path}` : path);
  /** A merchant page, by its clean path ("/", "/routing/5", "/onboarding"). */
  const merchantUrl = (path = "/"): string =>
    merchantOrigin ? `${merchantOrigin}${path}` : join("/merchant", path);
  /** A help page, by its clean path ("/", "/contact"). */
  const helpUrl = (path = "/"): string => {
    // On the help deploy a help page is on this host, by its clean path.
    if (config.appSurface === "help") return path;
    return helpOrigin ? `${helpOrigin}${path}` : join("/help", path);
  };
  /** An admin page, by its full path ("/admin/orders"). The admin deploy serves /admin/* as it is. */
  const adminUrl = (path = "/admin/dashboard"): string => (adminOrigin ? `${adminOrigin}${path}` : path);

  const hostKind = (host: string | null | undefined): HostKind => {
    const name = (host ?? "").trim().toLowerCase().replace(/:\d+$/, "");
    if (!root || !name) return "other";
    if (name === root || name === `www.${root}`) return "apex";
    if (name === `merchant.${root}`) return "merchant";
    if (name === `help.${root}`) return "help";
    return "other";
  };

  /** Old paths that still arrive (bookmarks, the mobile app, stored notification links). */
  const legacy = (pathname: string, search: string): string | null => {
    const shop = /^\/merchant\/(\d+)(\/.*)?$/.exec(pathname);
    if (shop) return appUrl(`/farms/${shop[1]}${shop[2] ?? ""}${search}`);
    const dash = stripPrefix(pathname, "/merchantDashboard");
    if (dash !== null) return merchantUrl(dash) + search;
    if (stripPrefix(pathname, "/merchantOnboarding") !== null) return merchantUrl("/onboarding") + search;
    // The merchant login moved from /login to /auth.
    if (pathname === "/merchant/login") return merchantUrl("/auth") + search;
    return null;
  };

  /** /help?section=... from before the split. */
  const legacyHelpSection = (search: string): string | null => {
    const section = new URLSearchParams(search).get("section");
    if (section === "terms") return helpUrl("/terms");
    if (section === "privacy") return helpUrl("/privacy");
    if (section === "contact") return helpUrl("/contact");
    if (section === "faq") return helpUrl("/");
    return null;
  };

  const route = (req: { host: string | null; pathname: string; search: string }): RouteDecision => {
    const { pathname, search } = req;
    if (isAsset(pathname) || pathname.startsWith("/_next/")) return { kind: "next" };

    if (config.appSurface === "help") {
      // Static help only: no API (no sign-in, no database on this deploy).
      if (stripPrefix(pathname, "/api") !== null) return { kind: "notFound" };
      const h = stripPrefix(pathname, "/help");
      if (h !== null) return { kind: "redirect", location: h + search };
      return { kind: "rewrite", path: join("/help", pathname) };
    }

    // The API routes are not page routes; the deploy's own code handles them.
    if (stripPrefix(pathname, "/api") !== null) return { kind: "next" };

    if (config.appSurface === "admin") {
      if (stripPrefix(pathname, "/admin") !== null) return { kind: "next" };
      if (hasPrefix(pathname, ADMIN_PASS_PREFIXES)) return { kind: "next" };
      if (pathname === "/") return { kind: "rewrite", path: "/admin/dashboard" };
      return { kind: "rewrite", path: `/admin${pathname}` };
    }

    // Public deploy: the admin area does not exist here.
    if (stripPrefix(pathname, "/admin") !== null) return { kind: "notFound" };

    const old = legacy(pathname, search);
    if (old) return { kind: "redirect", location: old };

    // Host rules only when links use subdomains too. Else a one-host link
    // ("/merchant/x") on a merchant. request would redirect to itself.
    const kind: HostKind = subdomainMode ? hostKind(req.host) : "other";

    if (search && (pathname === "/help" || (kind === "help" && pathname === "/"))) {
      const target = legacyHelpSection(search);
      if (target) return { kind: "redirect", location: target };
    }

    // On help. these are help pages (rewritten below); elsewhere they moved.
    if (kind !== "help" && MOVED_TO_HELP.includes(pathname)) {
      return { kind: "redirect", location: helpUrl(pathname) + search };
    }

    if (kind === "apex") {
      const m = stripPrefix(pathname, "/merchant");
      if (m !== null) return { kind: "redirect", location: merchantUrl(m) + search };
      const h = stripPrefix(pathname, "/help");
      if (h !== null) return { kind: "redirect", location: helpUrl(h) + search };
      return { kind: "next" };
    }

    if (kind === "merchant") {
      const m = stripPrefix(pathname, "/merchant");
      if (m !== null) return { kind: "redirect", location: m + search };
      // Each site signs in at /auth: here it is the Merchant Centre login, not
      // the buyer page. The old /login redirects to it.
      if (pathname === "/auth") return { kind: "rewrite", path: "/merchant/auth" };
      if (pathname === "/login") return { kind: "redirect", location: "/auth" + search };
      if (hasPrefix(pathname, SHARED_PREFIXES)) return { kind: "next" };
      if (hasPrefix(pathname, BUYER_PREFIXES)) return { kind: "redirect", location: appUrl(pathname + search) };
      const h = stripPrefix(pathname, "/help");
      if (h !== null) return { kind: "redirect", location: helpUrl(h) + search };
      return { kind: "rewrite", path: join("/merchant", pathname) };
    }

    if (kind === "help") {
      const h = stripPrefix(pathname, "/help");
      if (h !== null) return { kind: "redirect", location: h + search };
      if (hasPrefix(pathname, SHARED_PREFIXES) || hasPrefix(pathname, BUYER_PREFIXES)) {
        return { kind: "redirect", location: appUrl(pathname + search) };
      }
      if (stripPrefix(pathname, "/merchant") !== null) {
        return { kind: "redirect", location: merchantUrl(stripPrefix(pathname, "/merchant")!) + search };
      }
      return { kind: "rewrite", path: join("/help", pathname) };
    }

    return { kind: "next" };
  };

  /**
   * R3: a link stored by the backend (notifications) to the URL to open.
   * The stored values do not change; the mobile app reads them too.
   * Returns null for anything that is not a path on this site.
   */
  const resolveStoredLink = (link: string | null | undefined): string | null => {
    if (!link || !link.startsWith("/") || link.startsWith("//") || link.includes("\\")) return null;
    const q = link.search(/[?#]/);
    const pathname = q === -1 ? link : link.slice(0, q);
    const rest = q === -1 ? "" : link.slice(q);
    const old = legacy(pathname, rest);
    if (old) return old;
    if (MOVED_TO_HELP.includes(pathname)) return helpUrl(pathname) + rest;
    if (stripPrefix(pathname, "/admin") !== null) {
      return config.appSurface === "admin" ? link : adminUrl(link);
    }
    const h = stripPrefix(pathname, "/help");
    if (h !== null) return helpUrl(h) + rest;
    const m = stripPrefix(pathname, "/merchant");
    if (m !== null) return merchantUrl(m) + rest;
    return config.appSurface === "admin" ? link : appUrl(link);
  };

  /** The sign-in page of this deploy. The admin deploy has its own (email + password only). */
  const signInPath = (next?: string | null): string => {
    const base = config.appSurface === "admin" ? "/admin/login" : "/auth";
    return next && next !== "/" ? `${base}?next=${encodeURIComponent(next)}` : base;
  };

  /**
   * The Merchant Centre login (merchant.<root>/auth, or /merchant/auth on one
   * host). `next` is a path as the browser shows it; the dashboard needs none.
   * "/auth" is MERCHANT_PAGES.login (lib/merchant-links.ts; no imports here).
   */
  const merchantSignInPath = (next?: string | null): string => {
    const base = merchantUrl("/auth");
    if (!next || next === "/" || next === "/merchant" || next === merchantUrl("/")) return base;
    return `${base}?next=${encodeURIComponent(next)}`;
  };

  /**
   * Site standard: each site signs in on its own page. Admin deploy:
   * /admin/login. Merchant pages (merchant. host, or /merchant/* on one host):
   * the Merchant Centre login (merchant.<root>/auth). Everything else: /auth.
   */
  const signInPathFor = (where: { host: string | null; pathname: string }, next?: string | null): string => {
    if (config.appSurface === "admin") return signInPath(next);
    const onMerchant = subdomainMode
      ? hostKind(where.host) === "merchant"
      : stripPrefix(where.pathname, "/merchant") !== null;
    return onMerchant ? merchantSignInPath(next) : signInPath(next);
  };

  return {
    rootDomain: root,
    appSurface: config.appSurface,
    subdomainMode,
    appUrl,
    merchantUrl,
    helpUrl,
    adminUrl,
    hostKind,
    route,
    resolveStoredLink,
    signInPath,
    merchantSignInPath,
    signInPathFor,
  };
}

/** `url` with one more query parameter, e.g. ("/login?next=%2Fx", "reason", "idle"). */
export function withQueryParam(url: string, key: string, value: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

// Literal process.env reads, so that Next.js puts the values in client code
// (ROOT_DOMAIN and APP_SURFACE are passed through next.config.ts `env`).
const surfaces = makeSurfaces({
  rootDomain: process.env.ROOT_DOMAIN || "carabao.online",
  appSurface: process.env.APP_SURFACE === "admin" ? "admin" : process.env.APP_SURFACE === "help" ? "help" : "public",
  appUrl: process.env.NEXT_PUBLIC_APP_URL,
  mainUrl: process.env.NEXT_PUBLIC_MAIN_URL,
  merchantUrl: process.env.NEXT_PUBLIC_MERCHANT_URL,
  helpUrl: process.env.NEXT_PUBLIC_HELP_URL,
  adminUrl: process.env.NEXT_PUBLIC_ADMIN_URL,
});

export const { appUrl, merchantUrl, helpUrl, adminUrl, resolveStoredLink, signInPath, merchantSignInPath, signInPathFor } = surfaces;

/** The sign-in page for the site the browser is on now (signInPathFor). Browser only. */
export function signInPathHere(next?: string | null): string {
  if (typeof window === "undefined") return signInPath(next);
  return signInPathFor({ host: window.location.host, pathname: window.location.pathname }, next);
}
export const { rootDomain, appSurface, subdomainMode } = surfaces;
export const routeRequest = surfaces.route;
export const hostKind = surfaces.hostKind;
