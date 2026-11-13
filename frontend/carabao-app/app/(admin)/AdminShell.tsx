"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ComponentType } from "react";
import {
  ArrowLeftRight,
  Banknote,
  ClipboardCheck,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  Package,
  ScrollText,
  ShoppingBag,
  Store,
  Undo2,
  Users,
  X,
} from "lucide-react";
import { signOut } from "@/lib/auth-client";
import styles from "./layout.module.css";

type NavItem = { href: string; label: string; icon: ComponentType<{ size?: number; strokeWidth?: number }> };

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "General",
    items: [{ href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    title: "Money",
    items: [
      { href: "/admin/orders", label: "Orders", icon: ShoppingBag },
      { href: "/admin/transactions", label: "Transactions", icon: ArrowLeftRight },
      { href: "/admin/payouts", label: "Payouts", icon: Banknote },
      { href: "/admin/refunds", label: "Refunds", icon: Undo2 },
    ],
  },
  {
    title: "People",
    items: [
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/merchants", label: "Merchants", icon: Store },
      { href: "/admin/review", label: "Applications", icon: ClipboardCheck },
      { href: "/admin/listings", label: "Listings", icon: Package },
    ],
  },
  {
    title: "Support",
    items: [
      { href: "/admin/support", label: "Support", icon: LifeBuoy },
      { href: "/admin/audit-log", label: "Audit log", icon: ScrollText },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "A";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export default function AdminShell({
  user,
  children,
}: {
  user: { name: string; email: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMobileOpen(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      router.push("/auth");
    } catch {
      setSigningOut(false);
    }
  };

  const current = ALL_ITEMS.find((item) => isActive(pathname, item.href));
  const displayName = user.name || user.email || "Admin";
  const avatar = initials(displayName);

  return (
    <div className={styles.shell}>
      <button
        type="button"
        className={`${styles.backdrop} ${isMobileOpen ? styles.backdropVisible : ""}`}
        onClick={() => setIsMobileOpen(false)}
        aria-label="Close admin navigation"
        tabIndex={isMobileOpen ? 0 : -1}
      />

      <aside className={`${styles.sidebar} ${isMobileOpen ? styles.sidebarOpen : ""}`}>
        <div className={styles.brandRow}>
          <span className={styles.brandMark} aria-hidden="true">C</span>
          <span className={styles.brand}>
            Carabao <span className={styles.brandSub}>Admin</span>
          </span>
          <button
            type="button"
            className={styles.mobileClose}
            onClick={() => setIsMobileOpen(false)}
            aria-label="Close admin navigation"
          >
            <X size={18} />
          </button>
        </div>

        <nav className={styles.nav} aria-label="Admin">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className={styles.navGroup}>
              <p className={styles.navGroupTitle}>{group.title}</p>
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setIsMobileOpen(false)}
                  >
                    <Icon size={18} strokeWidth={1.75} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={styles.sidebarUser}>
          <span className={styles.avatar} aria-hidden="true">{avatar}</span>
          <div className={styles.userText}>
            <span className={styles.userName}>{displayName}</span>
            <span className={styles.userRole}>Admin</span>
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
            aria-label="Open admin navigation"
            aria-expanded={isMobileOpen}
          >
            <Menu size={20} />
          </button>
          <span className={styles.topbarTitle}>{current?.label ?? "Admin"}</span>
          <div className={styles.topbarRight}>
            <span className={styles.topbarName}>{displayName}</span>
            <span className={`${styles.avatar} ${styles.avatarSm}`} aria-hidden="true">{avatar}</span>
          </div>
        </header>
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
