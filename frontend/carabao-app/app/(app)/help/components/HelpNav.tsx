import Link from 'next/link';
import styles from '../page.module.css';
import { HELP_SECTIONS, type HelpSectionId } from '../sections';

// Left-column section switcher. Each item is a link so sections are
// shareable/bookmarkable and the browser back button works.
export default function HelpNav({ active }: { active: HelpSectionId }) {
  return (
    <nav className={styles.navCard} aria-label="Help sections">
      <ul className={styles.navList}>
        {HELP_SECTIONS.map((s) => (
          <li key={s.id}>
            <Link
              href={`/help?section=${s.id}`}
              replace
              scroll={false}
              className={`${styles.navItem} ${s.id === active ? styles.navItemActive : ''}`}
              aria-current={s.id === active ? 'page' : undefined}
            >
              <span aria-hidden="true">{s.icon}</span>
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
