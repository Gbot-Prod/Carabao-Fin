"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";
import "./sidebar.css";
import Logo from "@/public/images/icons/carabaoLogo.png";
import { LogoutButton } from "../LogoutButton";
import { useAuth } from "@/hooks/useAuth";


const navItems = [
  {
    href: "/order",
    label: "Order",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 7 C10.8 7 9.6 7.8 8.4 9.2 C6.8 11 6 13.8 6 15.5 C6 18 8.8 20.5 12 20.5 C15.2 20.5 18 18 18 15.5 C18 13.8 17.2 11 15.6 9.2 C14.4 7.8 13.2 7 12 7 C12.2 6.2 12.8 5.6 14 5.2 C14.8 4.9 15.8 5 16.6 5.8 C17.2 6.6 16.8 7.4 15.8 7.8 C14.6 8.2 13.2 7.6 12.8 7.2 Z"/></svg>
    ),
  },
  {
    href: "/cart",
    label: "Cart",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
    ),
  },
  {
    href: "/track",
    label: "Track",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
        <circle cx="12" cy="9" r="2.5" />
      </svg>
    ),
  },
  {
    href: "/history",
    label: "History",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    href: "/profile",
    label: "Profile",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  }
];

export default function Sidebar() {
  const pathname = usePathname();
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <img src={Logo.src} alt="Carabao Logo" className="sidebar__brand-icon" />
        <span className="sidebarBrandName">Carabao</span>
      </div>

      <nav className="sidebar__nav">
        <ul className="sidebar__nav-list">
          {navItems.map((item) => {
            const isActive =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`sidebar__nav-link${isActive ? " sidebar__nav-link--active" : ""}`}
                >
                  <span className="sidebar__nav-icon">{item.icon}</span>
                  <span className="sidebar__nav-label">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="sidebar__footer">
        {!isLoading && (
          isAuthenticated
            ? <LogoutButton />
            : <Link href="/auth" className="sidebar__nav-link m-3">Sign In</Link>
        )}
      </div>
    </aside>
  );
}

