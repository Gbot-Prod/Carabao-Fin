"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { searchProduce, type ProduceSearchResult, type ProduceSort } from "@/util/api/produceSearch";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { fmt, plural } from "@/lib/i18n/format";
import styles from "./ProduceResults.module.css";

const PAGE_SIZE = 24;
const SORTS: ProduceSort[] = ["relevance", "price_asc", "price_desc", "freshest", "newest"];

/** Produce tab of the browse page (U2): server-side search, filters and paging. */
export default function ProduceResults({ query }: { query: string }) {
  const { t } = useLanguage();
  const s = t.produceSearch;
  const [category, setCategory] = useState("");
  const [inStock, setInStock] = useState(true);
  const [fresh, setFresh] = useState(false);
  const [sort, setSort] = useState<ProduceSort>("relevance");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ProduceSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const key = JSON.stringify([query.trim(), category, inStock, fresh, sort, minPrice, maxPrice, page]);

  useEffect(() => {
    // Debounce typing; filters and paging apply at once.
    const timer = window.setTimeout(() => {
      searchProduce({
        q: query.trim() || undefined,
        category: category || undefined,
        in_stock: inStock,
        fresh,
        sort,
        min_price: minPrice ? Number(minPrice) : undefined,
        max_price: maxPrice ? Number(maxPrice) : undefined,
        page,
        page_size: PAGE_SIZE,
      })
        .then((res) => {
          setRows(res.items);
          setTotal(res.total);
          setError(false);
        })
        .catch(() => setError(true))
        .finally(() => setLoadedKey(key));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [key, query, category, inStock, fresh, sort, minPrice, maxPrice, page]);

  // A new search or filter starts again at page 1.
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  const loading = loadedKey !== key;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className={styles.wrap} aria-label={s.title}>
      <div className={styles.filters}>
        <select value={category} onChange={(e) => reset(setCategory)(e.target.value)} aria-label={s.category}>
          <option value="">{s.allCategories}</option>
          <option value="Vegetables">{t.listing.vegetables}</option>
          <option value="Fruits">{t.listing.fruits}</option>
        </select>
        <input
          type="number"
          min={0}
          inputMode="numeric"
          placeholder={s.minPrice}
          aria-label={s.minPrice}
          value={minPrice}
          onChange={(e) => reset(setMinPrice)(e.target.value)}
        />
        <input
          type="number"
          min={0}
          inputMode="numeric"
          placeholder={s.maxPrice}
          aria-label={s.maxPrice}
          value={maxPrice}
          onChange={(e) => reset(setMaxPrice)(e.target.value)}
        />
        <label className={styles.check}>
          <input type="checkbox" checked={inStock} onChange={(e) => reset(setInStock)(e.target.checked)} />
          {s.inStock}
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={fresh} onChange={(e) => reset(setFresh)(e.target.checked)} />
          {s.fresh}
        </label>
        <select value={sort} onChange={(e) => reset(setSort)(e.target.value as ProduceSort)} aria-label={s.sort}>
          {SORTS.map((value) => <option key={value} value={value}>{s.sorts[value]}</option>)}
        </select>
      </div>

      <p className={styles.count} aria-live="polite">
        {loading ? s.loading : plural(total, s.countOne, s.countMany)}
      </p>

      {error ? (
        <p className={styles.empty}>{s.error}</p>
      ) : !loading && rows.length === 0 ? (
        <p className={styles.empty}>{s.empty}</p>
      ) : (
        <ul className={styles.grid}>
          {rows.map((p) => (
            <li key={p.id}>
              <Link href={`/merchant/${p.merchant_id}`} className={styles.card}>
                {p.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image_url} alt={p.name ?? ""} className={styles.image} loading="lazy" />
                ) : (
                  <div className={styles.imagePlaceholder} aria-hidden />
                )}
                <div className={styles.body}>
                  <strong>{p.name}</strong>
                  <span className={styles.price}>₱{p.price} / {p.unit}</span>
                  <span className={styles.meta}>
                    {p.merchant_name}
                    {p.merchant_province ? ` · ${p.merchant_province}` : ""}
                  </span>
                  <span className={styles.meta}>
                    {p.stock_quantity > 0 ? fmt(s.stock, { qty: p.stock_quantity }) : s.outOfStock}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <div className={styles.pager}>
          <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>{s.prev}</button>
          <span>{fmt(s.pageOf, { page, pages })}</span>
          <button type="button" disabled={page >= pages || loading} onClick={() => setPage(page + 1)}>{s.next}</button>
        </div>
      )}
    </section>
  );
}
