"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import "./sidebar.css";
import Logo from "@/public/images/icons/carabaoLogo.png";
import { LogoutButton } from "@/components/LogoutButton";
import { useAuth } from "@/hooks/useAuth";
import { useAuthPrompt } from "@/components/AuthPrompt/AuthPromptContext";
import { SidebarFilterChips } from "./SidebarFilterChips";
import { fetchMyProfile, type UserProfile } from "@/util/api/users";

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

export default function Sidebar() {
  const pathname = usePathname();
  const { user, isAuthenticated, isBackendAuthenticated, isLoading } = useAuth();
  const { showPrompt } = useAuthPrompt();

  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    if (!isBackendAuthenticated) return;
    fetchMyProfile()
      .then(setProfile)
      .catch(() => setProfile(null));
  }, [isBackendAuthenticated]);

  const profileName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");
  const displayName = profileName || user?.name || (isAuthenticated ? "Carabao User" : "Guest");
  const displayEmail = profile?.email ?? user?.email ?? null;
  const avatarUrl = profile?.profile_picture_url ?? null;
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

  const renderNavLink = (
    href: string,
    label: string,
    icon: React.ReactNode,
    isProtected = false
  ) => {
    const blocked = isProtected && !isLoading && !isAuthenticated;
    const isActive = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <li key={href}>
        <Link
          href={blocked ? "#" : href}
          className={`sidebar__nav-link${isActive ? " sidebar__nav-link--active" : ""}`}
          onClick={blocked ? (e) => { e.preventDefault(); showPrompt(); } : () => setIsMobileOpen(false)}
        >
          <span className="sidebar__nav-icon">{icon}</span>
          <span className="sidebar__nav-label">{label}</span>
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

        <div className="sidebar__account">
          <div className="sidebar__avatar">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="sidebar__avatar-img" />
            ) : (
              <span className="sidebar__avatar-initials">{isAuthenticated ? initials : <UserIcon />}</span>
            )}
          </div>
          <div className="sidebar__account-text">
            <span className="sidebar__account-name">{isLoading ? "Loading..." : displayName}</span>
            {displayEmail && <span className="sidebar__account-email">{displayEmail}</span>}
          </div>
        </div>

        <nav className="sidebar__nav">
          <div className="sidebar__section">
            <ul className="sidebar__nav-list">
              {renderNavLink("/profile", "Profile", <UserIcon />, true)}
              {renderNavLink("/order", "Shops", <ShopIcon />)}
              {renderNavLink("/cart", "Cart", <CartIcon />)}
              {renderNavLink("/track", "Track", <TrackIcon />, true)}
              {renderNavLink("/orders", "Orders", <ReceiptIcon />, true)}
            </ul>
          </div>

          <div className="sidebar__section sidebar__section--divided">
            <SidebarFilterChips />
          </div>
        </nav>

        <div className="sidebar__footer">
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
                <span>Sign Out</span>
              </LogoutButton>
            ) : (
              <Link href="/auth" className="sidebar__nav-link">Sign In</Link>
            )
          )}
        </div>
      </aside>
    </>
  );
}
