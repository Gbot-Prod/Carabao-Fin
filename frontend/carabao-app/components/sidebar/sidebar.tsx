"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import "./sidebar.css";
import Logo from "@/public/images/icons/carabaoLogo.png";
import { LogoutButton } from "../LogoutButton";
import { useAuth } from "@/hooks/useAuth";
import { useAuthPrompt } from "@/components/AuthPrompt/AuthPromptContext";
import { SidebarFilterChips } from "./SidebarFilterChips";

const PROTECTED = new Set(["/track", "/history", "/profile", "/checkout", "/confirmation"]);
const SHOP_PATHS = ["/order", "/cart"];
const PROFILE_PATHS = ["/profile", "/history", "/track"];

function StoreIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function MangoIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 6c-2.8 0-5 2.8-5 6.5C7 17.5 9.5 21.5 12 21.5s5-4 5-9C17 8.8 14.8 6 12 6z" />
      <path d="M12 6c0-1.5.8-2.8 2-3.5" />
      <path d="M14 2.5c1.5-.5 3 .5 2.5 2.5" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function TrackIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`sidebar__chevron${open ? " sidebar__chevron--open" : ""}`}
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const { isAuthenticated, isLoading } = useAuth();
  const { showPrompt } = useAuthPrompt();

  const [shopsOpen, setShopsOpen] = useState(true);
  const [profileOpen, setProfileOpen] = useState(true);

  const renderNavLink = (
    href: string,
    label: string,
    icon: React.ReactNode,
    isProtected = false
  ) => {
    const blocked = isProtected && !isLoading && !isAuthenticated;
    const isActive = pathname.startsWith(href);
    return (
      <li key={href}>
        <Link
          href={blocked ? "#" : href}
          className={`sidebar__nav-link${isActive ? " sidebar__nav-link--active" : ""}`}
          onClick={blocked ? (e) => { e.preventDefault(); showPrompt(); } : undefined}
        >
          <span className="sidebar__nav-icon">{icon}</span>
          <span className="sidebar__nav-label">{label}</span>
        </Link>
      </li>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <img src={Logo.src} alt="Carabao Logo" className="sidebar__brand-icon" />
        <span className="sidebarBrandName">Carabao</span>
      </div>

      <nav className="sidebar__nav">
        <div className="sidebar__section">
          <button
            className="sidebar__section-header"
            onClick={() => setShopsOpen((o) => !o)}
            aria-expanded={shopsOpen}
          >
            <span className="sidebar__section-icon sidebar__section-icon--shops"><StoreIcon /></span>
            <span className="sidebar__section-title">Shops</span>
            <ChevronIcon open={shopsOpen} />
          </button>
          <div className={`sidebar__section-body${shopsOpen ? " sidebar__section-body--open" : ""}`}>
            <div className="sidebar__section-inner">
              <ul className="sidebar__nav-list">
                {renderNavLink("/order", "Browse Shops", <MangoIcon />)}
                {renderNavLink("/cart", "Cart", <CartIcon />)}
              </ul>
              <SidebarFilterChips />
            </div>
          </div>
        </div>

        <div className="sidebar__section sidebar__section--divided">
          <button
            className="sidebar__section-header"
            onClick={() => setProfileOpen((o) => !o)}
            aria-expanded={profileOpen}
          >
            <span className="sidebar__section-icon sidebar__section-icon--profile"><UserIcon /></span>
            <span className="sidebar__section-title">Profile</span>
            <ChevronIcon open={profileOpen} />
          </button>
          <div className={`sidebar__section-body${profileOpen ? " sidebar__section-body--open" : ""}`}>
            <div className="sidebar__section-inner">
              <ul className="sidebar__nav-list">
                {renderNavLink("/profile", "Settings", <SettingsIcon />, true)}
                {renderNavLink("/history", "History", <HistoryIcon />, true)}
                {renderNavLink("/track", "Current Orders", <TrackIcon />, true)}
              </ul>
            </div>
          </div>
        </div>
      </nav>

      <div className="sidebar__footer">
        {!isLoading && (
          isAuthenticated
            ? <LogoutButton />
            : <Link href="/auth" className="sidebar__nav-link">Sign In</Link>
        )}
      </div>
    </aside>
  );
}
