"use client";

// CF-0052 (B19): "Recently viewed farms" strip on the browse page. The list
// lives in this browser only (lib/recently-viewed.ts); nothing shows until a
// farm page has been opened, and the server render is always empty.

import Link from "next/link";
import { useSyncExternalStore } from "react";
import styles from "./RecentFarms.module.css";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { RECENT_FARMS_KEY, parseRecentFarms, rememberFarm, type RecentFarm } from "@/lib/recently-viewed";

const CHANGED = "carabao:recent-farms";
const EMPTY: RecentFarm[] = [];

function browserStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// useSyncExternalStore needs the same array for the same stored text.
let cachedRaw: string | null | undefined;
let cachedList: RecentFarm[] = EMPTY;
function snapshot(): RecentFarm[] {
  let raw: string | null = null;
  try {
    raw = browserStore()?.getItem(RECENT_FARMS_KEY) ?? null;
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedList = raw ? parseRecentFarms(raw) : EMPTY;
  }
  return cachedList;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange); // other tabs
  window.addEventListener(CHANGED, onChange); // this tab
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

/** Record a farm visit (farm page). Safe when storage is blocked. */
export function recordFarmVisit(farm: Omit<RecentFarm, "viewedAt">): void {
  if (rememberFarm(browserStore(), { ...farm, viewedAt: Date.now() })) {
    window.dispatchEvent(new Event(CHANGED));
  }
}

function clearRecentFarms(): void {
  try {
    browserStore()?.removeItem(RECENT_FARMS_KEY);
  } catch {
    // Blocked storage: nothing was saved either.
  }
  window.dispatchEvent(new Event(CHANGED));
}

export default function RecentFarms() {
  const { t } = useLanguage();
  const farms = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  if (farms.length === 0) return null;

  return (
    <section className={styles.section} aria-labelledby="recent-farms-title">
      <div className={styles.head}>
        <h2 id="recent-farms-title">{t.browse.recentTitle}</h2>
        <button type="button" className={styles.clear} onClick={clearRecentFarms}>
          {t.browse.recentClear}
        </button>
      </div>
      <ul className={styles.list}>
        {farms.map((f) => (
          <li key={f.id}>
            <Link href={`/farms/${f.id}`} className={styles.card}>
              {f.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.logo} alt="" className={styles.logo} />
              ) : (
                <span className={styles.logo} aria-hidden="true">{f.name.charAt(0).toUpperCase()}</span>
              )}
              <span className={styles.text}>
                <span className={styles.name}>{f.name}</span>
                {f.town && <span className={styles.town}>{f.town}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
