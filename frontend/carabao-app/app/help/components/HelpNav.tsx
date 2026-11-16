'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from '../page.module.css';
import { HELP_SECTIONS } from '../sections';

// Left-column section switcher. Each item is a link, so pages are shareable.
// The path is "/contact" on help.<root> and "/help/contact" on one host.
export default function HelpNav() {
  const raw = usePathname() ?? '/';
  const current = raw === '/help' ? '/' : raw.startsWith('/help/') ? raw.slice('/help'.length) : raw;
  return (
    <nav className={styles.navCard} aria-label="Help sections">
      <ul className={styles.navList}>
        {HELP_SECTIONS.map((s) => {
          const active = s.helpPath === current;
          return (
            <li key={s.id}>
              <Link
                href={s.href}
                className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <span aria-hidden="true">{s.icon}</span>
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
