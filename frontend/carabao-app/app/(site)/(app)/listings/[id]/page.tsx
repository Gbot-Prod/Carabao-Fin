"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import PageLoader from "@/components/PageLoader/PageLoader";
import { LoadError } from "@/components/Skeleton/Skeleton";
import SaveProduceButton from "@/components/SaveProduceButton/SaveProduceButton";
import { useSavedProduce } from "@/components/SaveProduceButton/useSavedProduce";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { fmt } from "@/lib/i18n/format";
import { activePause, shortDay } from "@/lib/store-pause";
import { getApiErrorStatus } from "@/util/errorHelper";
import { fetchListing, type ListingDetail } from "@/util/api/produceSearch";
import styles from "./page.module.css";

/** CF-0081 (B64): one listing, its farm, and other farms selling the same produce. */
export default function ListingPage() {
  const params = useParams<{ id: string }>();
  const produceId = Number(params.id);
  const valid = Number.isInteger(produceId) && produceId > 0;
  const { t } = useLanguage();
  const s = t.listingPage;
  const saved = useSavedProduce();
  const [data, setData] = useState<ListingDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!valid) return;
    let live = true;
    fetchListing(produceId)
      .then((res) => {
        if (!live) return;
        setData(res);
        setState("ready");
      })
      .catch((err) => {
        if (live) setState(getApiErrorStatus(err) === 404 ? "missing" : "error");
      });
    return () => {
      live = false;
    };
  }, [produceId, valid, attempt]);

  if (valid && state === "loading") return <PageLoader label={s.loading} />;
  if (state === "error") {
    return (
      <LoadError
        message={s.loadError}
        onRetry={() => {
          setState("loading");
          setAttempt((n) => n + 1);
        }}
      />
    );
  }
  if (!valid || state === "missing" || !data) {
    return (
      <div className={styles.page}>
        <p className={styles.empty}>{s.notFound}</p>
        <Link href="/order" className={styles.secondary}>
          {s.backToBrowse}
        </Link>
      </div>
    );
  }

  const { listing, farm, other_farms: others } = data;
  const paused = activePause(farm.paused_until);
  const town = [farm.city, farm.province].filter(Boolean).join(", ");

  return (
    <div className={styles.page}>
      <Link href="/order" className={styles.back}>
        ← {s.backToBrowse}
      </Link>

      <section className={styles.hero}>
        {listing.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={listing.image_url} alt={`Photo of ${listing.name}`} className={styles.photo} />
        ) : (
          <div className={styles.photo} aria-hidden />
        )}
        <div className={styles.info}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{listing.name}</h1>
            <SaveProduceButton
              produceName={listing.name}
              saved={saved.isSaved(listing.id)}
              busy={saved.isBusy(listing.id)}
              onToggle={() => saved.toggle(listing.id)}
            />
          </div>
          <p className={styles.price}>
            ₱{listing.price} / {listing.unit}
          </p>
          <p className={styles.meta}>
            {fmt(s.from, { farm: farm.merchant_name })}
            {town ? ` · ${town}` : ""}
            {farm.rating != null && farm.rating_count > 0
              ? ` · ${fmt(s.reviews, { rating: Number(farm.rating).toFixed(1), count: farm.rating_count })}`
              : ""}
          </p>
          <p className={styles.meta}>
            {listing.stock_quantity > 0 ? fmt(s.stock, { qty: listing.stock_quantity }) : s.outOfStock}
          </p>
          {paused && (
            <p className={styles.paused} role="status">
              {fmt(t.browse.onBreak, { date: shortDay(paused) })}
            </p>
          )}
          {listing.description && <p className={styles.description}>{listing.description}</p>}
          <Link href={`/farms/${farm.id}`} className={styles.primary}>
            {s.orderHere}
          </Link>
        </div>
      </section>

      <section className={styles.others} aria-labelledby="other-farms">
        <h2 id="other-farms" className={styles.sectionTitle}>
          {fmt(s.otherFarms, { name: listing.name ?? "" })}
        </h2>
        {others.length === 0 ? (
          <p className={styles.empty}>{s.noOtherFarms}</p>
        ) : (
          <ul className={styles.list}>
            {others.map((o) => {
              const otherPaused = activePause(o.merchant_paused_until);
              return (
                <li key={o.id}>
                  <Link href={`/listings/${o.id}`} className={styles.row}>
                    <span className={styles.rowFarm}>
                      <strong>{o.merchant_name}</strong>
                      {o.merchant_province ? <span className={styles.meta}> · {o.merchant_province}</span> : null}
                      {otherPaused && (
                        <span className={styles.pausedTag}>
                          {fmt(t.browse.onBreak, { date: shortDay(otherPaused) })}
                        </span>
                      )}
                    </span>
                    <span className={styles.rowPrice}>
                      ₱{o.price} / {o.unit}
                    </span>
                    <span className={styles.rowView}>{s.view}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
