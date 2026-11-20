"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import SkeletonList, { LoadError } from "@/components/Skeleton/Skeleton";
import SaveProduceButton from "@/components/SaveProduceButton/SaveProduceButton";
import { useAuthPrompt } from "@/components/AuthPrompt/AuthPromptContext";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { fmt } from "@/lib/i18n/format";
import { fetchSavedProduce, unsaveProduce, type SavedProduce } from "@/util/api/savedProduce";
import styles from "./page.module.css";

/** The buyer's saved produce (wishlist, CF-0038). */
export default function SavedProducePage() {
  const { t } = useLanguage();
  const s = t.saved;
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { showPrompt } = useAuthPrompt();
  const [items, setItems] = useState<SavedProduce[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [removing, setRemoving] = useState<number | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchSavedProduce()
      .then((rows) => {
        setItems(rows);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoaded(true));
  }, [isAuthenticated, attempt]);

  const remove = async (id: number) => {
    setRemoving(id);
    try {
      await unsaveProduce(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch {
      // keep it listed; the heart stays filled
    } finally {
      setRemoving(null);
    }
  };

  const retry = () => {
    setLoaded(false);
    setAttempt((n) => n + 1);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>{s.eyebrow}</p>
        <h1 className={styles.title}>{s.title}</h1>
      </div>

      <div className={styles.scroll}>
      {authLoading ? (
        <SkeletonList label={s.loading} rows={3} />
      ) : !isAuthenticated ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{s.signInTitle}</p>
          <button type="button" className={styles.action} onClick={() => showPrompt()}>{s.signIn}</button>
        </div>
      ) : !loaded ? (
        <SkeletonList label={s.loading} rows={3} />
      ) : error ? (
        <LoadError message={s.error} onRetry={retry} />
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{s.emptyTitle}</p>
          <p className={styles.emptyText}>{s.emptyText}</p>
          <Link href="/order" className={styles.action}>{s.browse}</Link>
        </div>
      ) : (
        <>
          <ul className={styles.grid}>
            {items.map((p) => (
              <li key={p.id} className={styles.item}>
                <div className={styles.save}>
                  <SaveProduceButton
                    produceName={p.name}
                    saved
                    busy={removing === p.id}
                    onToggle={() => remove(p.id)}
                  />
                </div>
                <Link href={`/farms/${p.merchant_id}`} className={styles.card}>
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_url} alt={p.name ? `Photo of ${p.name}` : "Produce photo"} className={styles.image} loading="lazy" />
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
                      {p.stock_quantity > 0
                        ? fmt(t.produceSearch.stock, { qty: p.stock_quantity })
                        : t.produceSearch.outOfStock}
                    </span>
                    <span className={styles.link}>{s.viewFarm} →</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <p className={styles.note}>{s.hiddenNote}</p>
        </>
      )}
      </div>
    </div>
  );
}
