"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, Search, SlidersHorizontal, X } from "lucide-react";
import type { SortOrder } from "@/util/api/admin";
import type { SortState } from "./SortHeader";
import styles from "./tablePanel.module.css";

/**
 * The page a table lives on. It is exactly the space under the topbar and
 * never scrolls itself: the TablePanel in it takes the whole of it, and only
 * the table rows scroll. Dialogs and side panels go in it too (they are fixed).
 */
export function TablePage({ children }: { children: ReactNode }) {
  return <div className={styles.page}>{children}</div>;
}

/**
 * The one layout every admin table uses, filling its TablePage:
 *
 *   header  — optional title and filters on the left, sort and search on the right.
 *             When they do not fit on one line, the filters fold behind a
 *             "Filters" button and open as a row under the header.
 *   summary — optional strip of figures (KPIs, totals for the filters)
 *   notice  — optional one-line message (saved, failed, …)
 *   body    — the table, scrolling inside itself (or a message in its place)
 *   footer  — "1–25 of 120" and the Previous / Next buttons, on the bottom edge
 *
 * The table's base look (head, cells, rules, hover) comes from this panel, so
 * pages only style their own columns and cell content.
 */
export default function TablePanel({
  title,
  filters,
  sort,
  search,
  summary,
  notice,
  message,
  messageTone,
  loading,
  pagination,
  count,
  activeFilters = 0,
  children,
}: {
  title?: ReactNode;
  /** Filter controls: TableFilter, TableSegments, TableChip. */
  filters?: ReactNode;
  /** How many filters are on, shown on the "Filters" button when they are folded. */
  activeFilters?: number;
  /** A TableSort. */
  sort?: ReactNode;
  /** A TableSearch. */
  search?: ReactNode;
  /** TableStat items. */
  summary?: ReactNode;
  notice?: { text: ReactNode; tone?: "error"; onDismiss?: () => void } | null;
  /** Shown in place of the table: the empty or error text. */
  message?: ReactNode;
  messageTone?: "error";
  loading?: boolean;
  pagination?: Paging;
  /** Unpaged tables: how many rows there are. */
  count?: number;
  children?: ReactNode;
}) {
  const hasHeader = Boolean(title || filters || sort || search);
  const { headerRef, leftRef, rightRef, folded } = useFoldingHeader(Boolean(filters));
  const [trayOpen, setTrayOpen] = useState(false);

  return (
    <section className={styles.panel}>
      {hasHeader && (
        // No filters to fold: the header may simply wrap (sort, search) instead.
        <div ref={headerRef} className={`${styles.header} ${folded || !filters ? styles.headerFolded : ""}`}>
          <div ref={leftRef} className={styles.left}>
            {title && <h2 className={styles.title}>{title}</h2>}
            {filters && !folded && filters}
            {filters && folded && (
              <button
                type="button"
                className={`${styles.filtersButton} ${trayOpen ? styles.filtersButtonOpen : ""}`}
                aria-expanded={trayOpen}
                onClick={() => setTrayOpen((open) => !open)}
              >
                <SlidersHorizontal size={14} strokeWidth={2.25} aria-hidden="true" />
                Filters
                {activeFilters > 0 && <span className={styles.filtersCount}>{activeFilters}</span>}
                <ChevronDown size={14} strokeWidth={2.25} aria-hidden="true" className={styles.filtersChevron} />
              </button>
            )}
          </div>
          {(sort || search) && (
            <div ref={rightRef} className={styles.right}>
              {sort}
              {search}
            </div>
          )}
        </div>
      )}

      {filters && folded && trayOpen && <div className={styles.tray}>{filters}</div>}

      {summary && <div className={styles.summary}>{summary}</div>}

      {notice && (
        <div
          className={`${styles.notice} ${notice.tone === "error" ? styles.noticeError : ""}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          <span>{notice.text}</span>
          {notice.onDismiss && (
            <button type="button" className={styles.noticeClose} onClick={notice.onDismiss} aria-label="Dismiss">
              <X size={14} strokeWidth={2.25} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      <div className={`${styles.body} ${loading ? styles.loading : ""}`} aria-busy={loading || undefined}>
        {message ? (
          <p className={`${styles.message} ${messageTone === "error" ? styles.messageError : ""}`} role={messageTone === "error" ? "alert" : undefined}>
            {message}
          </p>
        ) : (
          children
        )}
      </div>

      <TableFooter pagination={pagination} count={count} disabled={loading} />
    </section>
  );
}

/**
 * Paged tables (`page` counts from 1). With a known total the footer says
 * "26–50 of 120 · Page 2 of 5"; an API that sends no total gives the rows on
 * this page and whether there are more.
 */
export type Paging = { page: number; pageSize: number; onPageChange: (page: number) => void } & (
  | { total: number }
  | { rows: number; hasMore: boolean }
);

/**
 * Whether the header's filters must fold behind a "Filters" button. Unfolded,
 * the header is one line that does not wrap, so its parts keep their natural
 * width: if they are wider than the header, it folds, remembering that width;
 * it unfolds once the header is that wide again (and checks once more).
 */
function useFoldingHeader(hasFilters: boolean) {
  const headerRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [folded, setFolded] = useState(false);
  const needed = useRef(0);

  const check = useRef(() => {});

  function measure() {
    const header = headerRef.current;
    if (!header || !hasFilters) return;
    const css = getComputedStyle(header);
    const room = header.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
    if (!folded) {
      const gap = rightRef.current ? parseFloat(css.columnGap) || 0 : 0;
      const need = (leftRef.current?.scrollWidth ?? 0) + (rightRef.current?.scrollWidth ?? 0) + gap;
      if (need > room + 1) {
        needed.current = need;
        setFolded(true);
      }
    } else if (room >= needed.current) {
      setFolded(false);
    }
  }

  // The observer calls the latest measure (it reads this render's `folded`).
  useLayoutEffect(() => {
    check.current = measure;
  });

  // Fires once when observing starts, then on any change of the header's
  // width or of its parts' content (a filter chip appears, the filters fold),
  // after layout and before paint, so a fold never flashes.
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => check.current());
    for (const el of [headerRef.current, leftRef.current, rightRef.current]) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { headerRef, leftRef, rightRef, folded: hasFilters && folded };
}

function TableFooter({ pagination, count, disabled }: { pagination?: Paging; count?: number; disabled?: boolean }) {
  const page = pagination?.page ?? 1;
  const known = !pagination || "total" in pagination;
  const total = pagination && "total" in pagination ? pagination.total : (count ?? 0);
  const pageSize = pagination?.pageSize ?? Math.max(total, 1);
  const offset = (page - 1) * pageSize;
  const shown = pagination && "rows" in pagination ? pagination.rows : Math.max(0, Math.min(pageSize, total - offset));
  const start = shown === 0 ? 0 : offset + 1;
  const end = offset + shown;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const hasNext = pagination && "hasMore" in pagination ? pagination.hasMore : page < pages;
  const goTo = (p: number) => pagination?.onPageChange(p);

  return (
    <div className={styles.footer}>
      <span className={styles.range}>
        {start}–{end}
        {known && ` of ${total}`}
      </span>
      <div className={styles.pager}>
        <span className={styles.range}>
          Page {page}
          {known && ` of ${pages}`}
        </span>
        <button
          type="button"
          className={styles.pageButton}
          disabled={disabled || page <= 1}
          onClick={() => goTo(page - 1)}
        >
          <ChevronLeft size={14} strokeWidth={2.25} aria-hidden="true" />
          Previous
        </button>
        <button
          type="button"
          className={styles.pageButton}
          disabled={disabled || !hasNext}
          onClick={() => goTo(page + 1)}
        >
          Next
          <ChevronRight size={14} strokeWidth={2.25} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/**
 * The search box. It searches on Enter; emptying it (or its clear button)
 * drops the search straight away. `applied` is the search in effect now.
 */
export function TableSearch({
  applied,
  onSearch,
  placeholder,
  label,
  maxLength = 100,
}: {
  applied: string;
  onSearch: (q: string) => void;
  placeholder: string;
  label: string;
  maxLength?: number;
}) {
  const [value, setValue] = useState(applied);
  // Back/forward or a cleared filter changes the search in the URL: follow it.
  const [seen, setSeen] = useState(applied);
  if (applied !== seen) {
    setSeen(applied);
    setValue(applied);
  }

  return (
    <form
      className={styles.search}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(value.trim());
      }}
    >
      <Search size={15} strokeWidth={2} className={styles.searchIcon} aria-hidden="true" />
      <input
        type="search"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => {
          setValue(e.target.value);
          if (!e.target.value && applied) onSearch("");
        }}
      />
    </form>
  );
}

export type SortOption<K extends string> = { key: K; label: string; firstOrder?: SortOrder };

/**
 * "Sort [column] [↑/↓]". The same sort the column headers set; the first
 * option is the server's own order.
 */
export function TableSort<K extends string>({
  options,
  current,
  onSort,
  defaultLabel = "Default",
}: {
  options: SortOption<K>[];
  current: SortState<K>;
  onSort: (next: SortState<K>) => void;
  defaultLabel?: string;
}) {
  const asc = current.order === "asc";
  return (
    <div className={styles.sort}>
      <label className={styles.control}>
        <span className={styles.controlLabel}>Sort</span>
        <select
          value={current.sort ?? ""}
          onChange={(e) => {
            const opt = options.find((o) => o.key === e.target.value);
            onSort(opt ? { sort: opt.key, order: opt.firstOrder ?? "asc" } : { sort: null, order: "asc" });
          }}
        >
          <option value="">{defaultLabel}</option>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={styles.orderButton}
        disabled={!current.sort}
        onClick={() => current.sort && onSort({ sort: current.sort, order: asc ? "desc" : "asc" })}
        aria-label={asc ? "Ascending; switch to descending" : "Descending; switch to ascending"}
        title={asc ? "Ascending" : "Descending"}
      >
        {asc ? <ArrowUp size={14} strokeWidth={2.25} aria-hidden="true" /> : <ArrowDown size={14} strokeWidth={2.25} aria-hidden="true" />}
      </button>
    </div>
  );
}

/** A labelled select in the header: "Status [All ▾]". */
export function TableFilter({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className={styles.control}>
      <span className={styles.controlLabel}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}

/** A labelled date input in the header. */
export function TableDate({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className={styles.control}>
      <span className={styles.controlLabel}>{label}</span>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** A small set of views, one picked: All | Users | Admins. */
export function TableSegments<V extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
  disabled?: boolean;
}) {
  return (
    <div className={styles.segments} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value || "all"}
          type="button"
          aria-pressed={value === o.value}
          className={`${styles.segment} ${value === o.value ? styles.segmentActive : ""}`}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** One figure in the summary strip: label, value, and an optional hint. */
export function TableStat({
  label,
  value,
  hint,
  alert,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  alert?: boolean;
}) {
  return (
    <div className={`${styles.stat} ${alert ? styles.statAlert : ""}`}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {hint && <span className={styles.statHint}>{hint}</span>}
    </div>
  );
}

/** A filter that is on, with a button to drop it: "Merchant #4 only ×", or "Clear filters". */
export function TableChip({ children, onClear, label }: { children: ReactNode; onClear: () => void; label?: string }) {
  return (
    <button type="button" className={styles.chip} onClick={onClear} aria-label={label}>
      {children}
      <X size={13} strokeWidth={2.25} aria-hidden="true" />
    </button>
  );
}
