'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { helpUrl } from '@/lib/urls';
import styles from '../header.module.css';
import { FAQ_GROUPS } from '../faqs';

// Header search over the FAQ. Static: it matches question text and keywords
// in the browser and links to the answer (/#<id>), which OpenFaqOnHash opens.

const INDEX = FAQ_GROUPS.flatMap((g) =>
  g.items.map((f) => ({
    id: f.id,
    q: f.q,
    group: g.heading,
    text: `${f.q} ${f.keywords ?? ''} ${g.heading}`.toLowerCase(),
  })),
);

export default function HelpSearch() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const wrap = useRef<HTMLDivElement | null>(null);

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return INDEX.filter((f) => words.every((w) => f.text.includes(w))).slice(0, 6);
  }, [query]);

  const go = (id: string) => {
    setOpen(false);
    window.location.assign(`${helpUrl('/')}#${id}`);
  };

  const showList = open && query.trim().length > 0;

  return (
    <div
      className={styles.search}
      ref={wrap}
      onBlur={(e) => {
        if (!wrap.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const pick = results[active] ?? results[0];
          if (pick) go(pick.id);
        }}
      >
        <Search size={16} strokeWidth={2} className={styles.searchIcon} aria-hidden="true" />
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search help"
          aria-label="Search help"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
      </form>
      {showList && (
        <ul id={listId} className={styles.results} role="listbox">
          {results.length === 0 ? (
            <li className={styles.noResults}>No matching questions</li>
          ) : (
            results.map((r, i) => (
              <li key={r.id} role="option" aria-selected={i === active}>
                <a
                  href={`${helpUrl('/')}#${r.id}`}
                  className={`${styles.result} ${i === active ? styles.resultActive : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={(e) => {
                    e.preventDefault();
                    go(r.id);
                  }}
                >
                  <span className={styles.resultQ}>{r.q}</span>
                  <span className={styles.resultGroup}>{r.group}</span>
                </a>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
