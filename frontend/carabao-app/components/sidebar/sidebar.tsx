"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import "./sidebar.css";
import Logo from "@/public/images/icons/carabaoLogo.png";
import { LogoutButton } from "@/components/LogoutButton";
import LanguageToggle from "@/components/LanguageToggle/LanguageToggle";
import { useNotifications } from "@/components/Notifications/NotificationsProvider";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useAuth } from "@/hooks/useAuth";
import { useAuthPrompt } from "@/components/AuthPrompt/AuthPromptContext";
import { fetchMyProfile, type UserProfile } from "@/util/api/users";
import { appUrl, helpUrl, hostKind, merchantUrl } from "@/lib/urls";

function ShopIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s-7.5-4.6-9.6-9.2C1 8.6 3 5 6.6 5c2.1 0 3.5 1.1 4.4 2.4C11.9 6.1 13.3 5 15.4 5 19 5 21 8.6 19.6 11.8 17.5 16.4 12 21 12 21z" />
    </svg>
  );
}

function ReceiptIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z" />
      <line x1="8" y1="9" x2="16" y2="9" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="12" y2="17" />
    </svg>
  );
}

function TrackIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}

function StoreIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
      <path d="M5 12v8h14v-8" />
      <path d="M10 20v-5h4v5" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

// The host does not change while the page is open.
const noSubscribe = () => () => {};

export default function Sidebar() {
  const pathname = usePathname();
  const { user, isAuthenticated, isBackendAuthenticated, isLoading } = useAuth();
  const { showPrompt } = useAuthPrompt();
  const { t } = useLanguage();
  const { unread: unreadNotifications } = useNotifications();

  const [isMobileOpen, setIsMobileOpen] = useState(false);
  // The sidebar also shows on merchant.<root>, so buyer links go to the apex.
  // The server does not know the browser's host, so it renders false.
  const onMerchantHost = useSyncExternalStore(
    noSubscribe,
    () => hostKind(window.location.host) === "merchant",
    () => false
  );
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    if (!isBackendAuthenticated) return;
    fetchMyProfile()
      .then(setProfile)
      .catch(() => setProfile(null));
  }, [isBackendAuthenticated]);

  const profileName = profile?.name ?? "";
  const displayName = profileName || user?.name || (isAuthenticated ? "Carabao User" : "Guest");
  const displayEmail = profile?.email ?? user?.email ?? null;
  const avatarUrl = profile?.profile_picture_url ?? null;
  const profileBlocked = !isLoading && !isAuthenticated;
  // A merchant row only exists once an admin approves the application.
  const merchantId = isBackendAuthenticated ? profile?.merchant?.id ?? null : null;
  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMobileOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  // href may be on another host; activePath is the path that marks it active
  // on this host, and forceActive marks it active anyway.
  const renderNavLink = (
    href: string,
    label: string,
    icon: React.ReactNode,
    isProtected = false,
    activePath: string = href,
    forceActive = false,
    badge = 0
  ) => {
    const blocked = isProtected && !isLoading && !isAuthenticated;
    const isActive =
      forceActive || (!onMerchantHost && (pathname === activePath || pathname.startsWith(`${activePath}/`)));
    return (
      <li key={href}>
        <Link
          href={blocked ? "#" : href}
          className={`sidebar__nav-link${isActive ? " sidebar__nav-link--active" : ""}`}
          onClick={blocked ? (e) => { e.preventDefault(); showPrompt(); } : () => setIsMobileOpen(false)}
        >
          <span className="sidebar__nav-icon">{icon}</span>
          <span className="sidebar__nav-label">{label}</span>
          {badge > 0 && (
            <span className="sidebar__nav-badge" aria-label={`${badge} unread`}>{badge > 99 ? "99+" : badge}</span>
          )}
        </Link>
      </li>
    );
  };

  return (
    <>
      <button
        type="button"
        className="sidebar__mobile-toggle"
        onClick={() => setIsMobileOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={isMobileOpen}
      >
        <span />
        <span />
        <span />
      </button>

      <button
        type="button"
        className={`sidebar__backdrop${isMobileOpen ? " sidebar__backdrop--visible" : ""}`}
        onClick={() => setIsMobileOpen(false)}
        aria-label="Close navigation menu"
        tabIndex={isMobileOpen ? 0 : -1}
      />

      <aside className={`sidebar${isMobileOpen ? " sidebar--mobile-open" : ""}`}>
        <button
          type="button"
          className="sidebar__mobile-close"
          onClick={() => setIsMobileOpen(false)}
          aria-label="Close navigation menu"
        >
          &times;
        </button>
        <div className="sidebar__brand">
          <Image src={Logo} alt="Carabao Logo" className="sidebar__brand-icon" />
          <span className="sidebarBrandName">Carabao</span>
        </div>

        
        <Link
          href={profileBlocked ? "#" : appUrl("/profile")}
          className={`sidebar__account${pathname === "/profile" ? " sidebar__account--active" : ""}`}
          onClick={profileBlocked ? (e) => { e.preventDefault(); showPrompt(); } : () => setIsMobileOpen(false)}
          aria-label={t.nav.openProfile}
        >
          
          <div className="sidebar__avatar">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="sidebar__avatar-img" />
            ) : (
              <span className="sidebar__avatar-initials">{isAuthenticated ? initials : <UserIcon />}</span>
            )}
          </div>
          <div className="sidebar__account-text">
            <span className="sidebar__account-name">{isLoading ? t.nav.loading : displayName}</span>
            {displayEmail && <span className="sidebar__account-email">{displayEmail}</span>}
          </div>
        </Link>

        <nav className="sidebar__nav">
          <div className="sidebar__section">
            <ul className="sidebar__nav-list">
              {renderNavLink(appUrl("/order"), t.nav.shops, <ShopIcon />, false, "/order")}
              {renderNavLink(appUrl("/cart"), t.nav.cart, <CartIcon />, false, "/cart")}
              {renderNavLink(appUrl("/track"), t.nav.track, <TrackIcon />, true, "/track")}
              {renderNavLink(appUrl("/orders"), t.nav.orders, <ReceiptIcon />, true, "/orders")}
              {renderNavLink(appUrl("/saved"), t.nav.saved, <HeartIcon />, true, "/saved")}
            </ul>
          </div>

          {merchantId != null && (
            <div className="sidebar__section sidebar__section--divided">
              <div className="sidebar__merchant">
                <span className="sidebar__merchant-label">{t.nav.merchant}</span>
                <ul className="sidebar__nav-list">
                  {renderNavLink(appUrl(`/farms/${merchantId}`), t.nav.myShopPage, <StoreIcon />, true, `/farms/${merchantId}`)}
                  {/* Active on merchant.<root>, or on /merchant when the site runs on one host. */}
                  {renderNavLink(merchantUrl("/"), t.nav.dashboard, <DashboardIcon />, true, "/merchant", onMerchantHost)}
                </ul>
              </div>
            </div>
          )}

          {isAuthenticated && (
            <div className="sidebar__section sidebar__section--divided">
              <ul className="sidebar__nav-list">
                {renderNavLink(appUrl("/notifications"), t.nav.notifications, <BellIcon />, true, "/notifications", false, unreadNotifications)}
              </ul>
            </div>
          )}
        </nav>

        <div className="sidebar__footer">
          <LanguageToggle className="sidebar__language" />
          {/* Help is public: shown to guests and signed-in users alike */}
          <Link
            href={helpUrl("/")}
            className="sidebar__nav-link sidebar__help"
            onClick={() => setIsMobileOpen(false)}
          >
            <span className="sidebar__nav-icon"><HelpIcon /></span>
            <span className="sidebar__nav-label">{t.nav.help}</span>
          </Link>
          {!isLoading && (
            isAuthenticated ? (
              <LogoutButton className="sidebar__logout sidebar__logout-button">
                <span className="sidebar__nav-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                </span>
                <span>{t.nav.signOut}</span>
              </LogoutButton>
            ) : (
              <Link href="/auth" className="sidebar__nav-link">{t.nav.signIn}</Link>
            )
          )}
        </div>
      </aside>
    </>
  );
}
