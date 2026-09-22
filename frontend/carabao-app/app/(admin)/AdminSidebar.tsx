"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "@/lib/auth-client";
import styles from "./layout.module.css";

const NAV_ITEMS = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/merchants", label: "Merchants" },
  { href: "/admin/review", label: "Review" },
  { href: "/admin/payouts", label: "Payouts" },
];

export default function AdminSidebar() {
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

  return (
    <>
      <button
        type="button"
        className={styles.mobileToggle}
        onClick={() => setIsMobileOpen(true)}
        aria-label="Open admin navigation"
        aria-expanded={isMobileOpen}
      >
        <span />
        <span />
        <span />
      </button>
      <button
        type="button"
        className={`${styles.backdrop} ${isMobileOpen ? styles.backdropVisible : ""}`}
        onClick={() => setIsMobileOpen(false)}
        aria-label="Close admin navigation"
        tabIndex={isMobileOpen ? 0 : -1}
      />
      <aside className={`${styles.sidebar} ${isMobileOpen ? styles.sidebarOpen : ""}`}>
        <button
          type="button"
          className={styles.mobileClose}
          onClick={() => setIsMobileOpen(false)}
          aria-label="Close admin navigation"
        >
          &times;
        </button>
        <div className={styles.sidebarTop}>
          <span className={styles.brand}>Carabao Admin</span>
          <nav className={styles.nav}>
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navLink} ${pathname === item.href ? styles.navLinkActive : ""}`}
                onClick={() => setIsMobileOpen(false)}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className={styles.sidebarBottom}>
          <button
            className={styles.signOutBtn}
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>
    </>
  );
}
