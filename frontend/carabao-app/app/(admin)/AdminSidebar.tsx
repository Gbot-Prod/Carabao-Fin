"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/lib/auth-client";
import styles from "./layout.module.css";

const NAV_ITEMS = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/merchants", label: "Merchants" },
  { href: "/admin/review", label: "Review" },
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

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
    <aside className={styles.sidebar}>
      <div className={styles.sidebarTop}>
        <span className={styles.brand}>Carabao Admin</span>
        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navLink} ${pathname === item.href ? styles.navLinkActive : ""}`}
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
  );
}
