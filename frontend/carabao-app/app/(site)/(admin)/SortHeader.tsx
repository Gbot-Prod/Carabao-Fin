import type { SortOrder } from "@/util/api/admin";
import styles from "./sortHeader.module.css";

export type SortState<K extends string> = { sort: K | null; order: SortOrder };

type Params = { get(name: string): string | null };

/**
 * The table sort in the URL (?sort=<key>&order=asc|desc). An unknown key
 * gives `fallback`: the order the server uses when no sort is sent.
 */
export function readSort<K extends string>(
  params: Params,
  keys: readonly K[],
  fallback: SortState<K> = { sort: null, order: "asc" },
): SortState<K> {
  const raw = params.get("sort");
  const sort = keys.find((k) => k === raw);
  if (!sort) return fallback;
  return { sort, order: params.get("order") === "desc" ? "desc" : "asc" };
}

/** Writes the sort into `params`. A null sort writes nothing (the server's own order). */
export function writeSort<K extends string>(params: URLSearchParams, state: SortState<K>) {
  if (!state.sort) return;
  params.set("sort", state.sort);
  params.set("order", state.order);
}

type Props<K extends string> = {
  label: string;
  sortKey: K;
  current: SortState<K>;
  onSort: (next: SortState<K>) => void;
  /** The order of the first click: "desc" for dates and counts (newest, most first). */
  firstOrder?: SortOrder;
  className?: string;
};

/**
 * A column header that sorts the table. The first click sorts on the column,
 * the next click turns the order around.
 */
export default function SortHeader<K extends string>({
  label,
  sortKey,
  current,
  onSort,
  firstOrder = "asc",
  className,
}: Props<K>) {
  const active = current.sort === sortKey;
  const nextOrder: SortOrder = active ? (current.order === "asc" ? "desc" : "asc") : firstOrder;
  const ariaSort = active ? (current.order === "asc" ? "ascending" : "descending") : "none";

  return (
    <th className={className} aria-sort={ariaSort}>
      <button
        type="button"
        className={`${styles.button} ${active ? styles.active : ""}`}
        onClick={() => onSort({ sort: sortKey, order: nextOrder })}
        title={`Sort by ${label.toLowerCase()}, ${nextOrder === "asc" ? "ascending" : "descending"}`}
      >
        {label}
        <span className={styles.arrow} aria-hidden="true">
          {active ? (current.order === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}
