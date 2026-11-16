"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import {
  Banknote,
  Boxes,
  ExternalLink,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  Package,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Star,
  Store,
  Truck,
  X,
} from "lucide-react";
import NotificationBell from "@/components/NotificationBell/NotificationBell";
import SkeletonList, { LoadError } from "@/components/Skeleton/Skeleton";
import { signOut } from "@/lib/auth-client";
import { appUrl, helpUrl, merchantUrl, signInPath } from "@/lib/urls";
import { useMerchant } from "./MerchantContext";
import styles from "./shell.module.css";

type Icon = ComponentType<{ size?: number; strokeWidth?: number }>;
type NavItem = { path: string; label: string; icon: Icon; count?: number; countTone?: "alert"; also?: string[] };

/**
 * The page path without the "/merchant" prefix. On merchant.<root> the browser
 * path is already clean; on one host (localhost) it is "/merchant/...".
 */
function cleanPath(pathname: string): string {
  if (pathname === "/merchant") return "/";
  if (pathname.startsWith("/merchant/")) return pathname.slice("/merchant".length);
  return pathname || "/";
}

const matches = (path: string, itemPath: string) =>
  itemPath === "/" ? path === "/" : path === itemPath || path.startsWith(`${itemPath}/`);

/** Active on its own path, or on a related page ("/routing/5" marks Shipments). */
const isActive = (path: string, item: NavItem) => [item.path, ...(item.also ?? [])].some((p) => matches(path, p));

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "M";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function Gate({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.gate}>
      <div className={styles.gateCard} role="alert">
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export default function MerchantShell({ children }: { children: ReactNode }) {
  const pathname = cleanPath(usePathname() ?? "/");
  const { status, performance, ordersState, produces, shopPage, userName, userEmail, reloadPerformance } = useMerchant();
  const [signingOut, setSigningOut] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMobileOpen(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  if (status === "signed-out") {
    return (
      <Gate title="Sign in to continue">
        <p>Sign in with your Carabao account to open the merchant dashboard.</p>
        <button
          type="button"
          className={styles.gateButton}
          onClick={() => window.location.assign(signInPath(window.location.pathname))}
        >
          Sign in
        </button>
      </Gate>
    );
  }

  if (status === "not-merchant") {
    return (
      <Gate title="No merchant profile">
        <p>This account does not have a merchant profile. Apply to become a merchant and start to sell your produce.</p>
        <div className={styles.gateActions}>
          <Link className={styles.gateButton} href={merchantUrl("/onboarding")}>Apply as merchant</Link>
          <a className={styles.gateButtonSecondary} href={appUrl("/profile")}>Back to profile</a>
        </div>
      </Gate>
    );
  }

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      window.location.assign(appUrl("/"));
    } catch {
      setSigningOut(false);
    }
  };

  const readyCount = ordersState.readyToShip.length;
  const activeOrders = performance?.active_orders ?? 0;
  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: "General",
      items: [{ path: "/", label: "Dashboard", icon: LayoutDashboard }],
    },
    {
      title: "Sales",
      items: [
        { path: "/sales", label: "Orders", icon: ShoppingBag, count: activeOrders || undefined },
        { path: "/shipments", label: "Shipments", icon: Truck, count: readyCount || undefined, countTone: "alert", also: ["/routing"] },
        { path: "/earnings", label: "Earnings", icon: Banknote },
        { path: "/reviews", label: "Reviews", icon: Star },
      ],
    },
    {
      title: "Store",
      items: [
        { path: "/produce", label: "Produce", icon: Package, count: produces.length || undefined },
        { path: "/inventory", label: "Inventory", icon: Boxes },
        { path: "/shop", label: "Shop page", icon: Store },
        { path: "/settings", label: "Settings", icon: Settings },
      ],
    },
  ];

  const current = groups.flatMap((g) => g.items).find((item) => isActive(pathname, item));
  const shopName = performance?.merchant_name || "Your shop";
  const displayName = userName || userEmail || "Merchant";
  const avatar = initials(shopName);

  let body: ReactNode = children;
  if (status === "loading") {
    body = (
      <div className={styles.mainPad}>
        <SkeletonList label="Loading your shop…" rows={4} />
      </div>
    );
  } else if (status === "error") {
    body = (
      <div className={styles.mainPad}>
        <LoadError
          message="We couldn't load your merchant dashboard. Check your connection and try again."
          onRetry={reloadPerformance}
        />
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <button
        type="button"
        className={`${styles.backdrop} ${isMobileOpen ? styles.backdropVisible : ""}`}
        onClick={() => setIsMobileOpen(false)}
        aria-label="Close merchant navigation"
        tabIndex={isMobileOpen ? 0 : -1}
      />

      <aside className={`${styles.sidebar} ${isMobileOpen ? styles.sidebarOpen : ""}`}>
        <div className={styles.brandRow}>
          {shopPage?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shopPage.logo_url} alt="" className={styles.brandLogo} />
          ) : (
            <span className={styles.brandMark} aria-hidden="true">C</span>
          )}
          <span className={styles.brand}>
            Carabao <span className={styles.brandSub}>Merchant</span>
          </span>
          <button
            type="button"
            className={styles.mobileClose}
            onClick={() => setIsMobileOpen(false)}
            aria-label="Close merchant navigation"
          >
            <X size={18} />
          </button>
        </div>

        <nav className={styles.nav} aria-label="Merchant">
          {groups.map((group) => (
            <div key={group.title} className={styles.navGroup}>
              <p className={styles.navGroupTitle}>{group.title}</p>
              {group.items.map((item) => {
                const active = isActive(pathname, item);
                const ItemIcon = item.icon;
                return (
                  <Link
                    key={item.path}
                    href={merchantUrl(item.path)}
                    className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setIsMobileOpen(false)}
                  >
                    <ItemIcon size={18} strokeWidth={1.75} />
                    <span>{item.label}</span>
                    {item.count !== undefined && (
                      <span className={`${styles.navCount} ${item.countTone === "alert" ? styles.navCountAlert : ""}`}>
                        {item.count}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}

          <div className={styles.navGroup}>
            <p className={styles.navGroupTitle}>Elsewhere</p>
            {performance && (
              <a className={styles.navLink} href={appUrl(`/farms/${performance.merchant_id}`)} target="_blank" rel="noreferrer">
                <ExternalLink size={18} strokeWidth={1.75} />
                <span>View my shop</span>
              </a>
            )}
            <a className={styles.navLink} href={appUrl("/order")}>
              <ShoppingCart size={18} strokeWidth={1.75} />
              <span>Buyer site</span>
            </a>
            <a className={styles.navLink} href={helpUrl("/")}>
              <LifeBuoy size={18} strokeWidth={1.75} />
              <span>Help</span>
            </a>
          </div>
        </nav>

        <div className={styles.sidebarUser}>
          <span className={styles.avatar} aria-hidden="true">{avatar}</span>
          <div className={styles.userText}>
            <span className={styles.userName}>{shopName}</span>
            <span className={styles.userRole}>{displayName}</span>
          </div>
          <button
            type="button"
            className={styles.signOutBtn}
            onClick={handleSignOut}
            disabled={signingOut}
            aria-label={signingOut ? "Signing out" : "Sign out"}
            title="Sign out"
          >
            <LogOut size={17} strokeWidth={1.75} />
          </button>
        </div>
      </aside>

      <div className={styles.content}>
        <header className={styles.topbar}>
          <button
            type="button"
            className={styles.mobileToggle}
            onClick={() => setIsMobileOpen(true)}
            aria-label="Open merchant navigation"
            aria-expanded={isMobileOpen}
          >
            <Menu size={20} />
          </button>
          <span className={styles.topbarTitle}>{current?.label ?? "Merchant"}</span>
          <div className={styles.topbarRight}>
            <NotificationBell />
            <a className={styles.topbarProfile} href={appUrl("/profile")} title="My profile">
              <span className={styles.topbarName}>{displayName}</span>
              <span className={`${styles.avatar} ${styles.avatarSm}`} aria-hidden="true">{initials(displayName)}</span>
            </a>
          </div>
        </header>
        <main className={styles.main}>{body}</main>
      </div>
    </div>
  );
}
