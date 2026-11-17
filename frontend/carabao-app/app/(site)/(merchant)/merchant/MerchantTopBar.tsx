"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, ShoppingCart } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { signOut } from "@/lib/auth-client";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { appUrl, helpUrl, merchantUrl } from "@/lib/urls";
import Logo from "@/public/images/icons/carabaoLogo.png";
import { merchantLoginUrl } from "./lib/signIn";
import styles from "./topBar.module.css";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Name, with a menu: the buyer site, and sign-out. */
function UserMenu({ name }: { name: string }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      window.location.assign(merchantLoginUrl());
    } catch {
      setSigningOut(false);
    }
  };

  return (
    <div className={styles.user} ref={wrap}>
      <button
        type="button"
        className={styles.userButton}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.avatar} aria-hidden="true">{initials(name)}</span>
        <span className={styles.userName}>{name}</span>
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open && (
        <div className={styles.menu}>
          <a className={styles.menuItem} href={appUrl("/order")}>
            <ShoppingCart size={16} strokeWidth={1.75} aria-hidden="true" />
            {t.merchantAuth.buyerSite}
          </a>
          <button type="button" className={styles.menuItem} onClick={handleSignOut} disabled={signingOut}>
            <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
            {signingOut ? t.auth.pleaseWait : t.nav.signOut}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The Merchant Centre top bar for pages without the merchant sidebar: login,
 * the welcome page for non-merchants, and onboarding.
 */
export default function MerchantTopBar() {
  const { t } = useLanguage();
  const { user, isAuthenticated } = useAuth();
  const name = user?.name || user?.email || user?.phoneNumber || "";

  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <a className={styles.brand} href={merchantUrl("/")}>
          {/* The logo is white: it needs the green mark behind it. */}
          <span className={styles.logoMark}>
            <Image src={Logo} alt="" className={styles.logo} priority />
          </span>
          <span className={styles.brandName}>Carabao</span>
          <span className={styles.brandDivider} aria-hidden="true" />
          <span className={styles.brandCentre}>{t.merchantAuth.centre}</span>
        </a>
        <div className={styles.right}>
          <a className={styles.help} href={helpUrl("/")}>{t.merchantAuth.needHelp}</a>
          {isAuthenticated && <UserMenu name={name || t.merchantAuth.account} />}
        </div>
      </div>
    </header>
  );
}
