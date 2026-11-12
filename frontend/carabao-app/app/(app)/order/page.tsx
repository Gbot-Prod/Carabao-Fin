"use client";

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Clock, Search, ShoppingCart, Star, Store, Truck, X } from 'lucide-react';
import styles from './page.module.css';
import PageLoader from '@/components/PageLoader/PageLoader';
import { fetchMerchants, fetchMerchantShopPage, fetchMyCart } from '@/util/api';
import { fetchMyFollows } from '@/util/api/merchants';
import { useLanguage } from '@/lib/i18n/LanguageProvider';
import ProduceResults from './ProduceResults';
import { fmt, plural } from '@/lib/i18n/format';
import type { Strings } from '@/lib/i18n/strings/en';

type FarmView = {
  merchantId: number;
  name: string;
  rating: number;
  deliveryTimeDays: number | null;
  category: string | null; // null: shown as the translated default
  deliveryFee: number;
  logoUrl: string | null;
  bannerUrl: string | null;
};

type SortKey = 'recommended' | 'rating' | 'fastest' | 'fee';

const SORT_OPTIONS: { value: SortKey; label: keyof Strings['browse'] }[] = [
  { value: 'recommended', label: 'sortRecommended' },
  { value: 'rating', label: 'sortRating' },
  { value: 'fastest', label: 'sortFastest' },
  { value: 'fee', label: 'sortFee' },
];

const toFarmView = (merchant: Awaited<ReturnType<typeof fetchMerchants>>[number]): FarmView => ({
  merchantId: merchant.id,
  name: merchant.merchant_name,
  rating: merchant.rating ?? 0,
  deliveryTimeDays: merchant.delivery_time ?? null,
  category: merchant.category ?? null,
  deliveryFee: merchant.delivery_price ?? 0,
  logoUrl: null,
  bannerUrl: null,
});

const formatDeliveryTime = (days: number | null, t: Strings) =>
  days === null ? t.browse.deliveryVaries : plural(days, t.browse.deliveryDayOne, t.browse.deliveryDayMany);

const getInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');

function OrderContent() {
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const [farmList, setFarmList] = useState<FarmView[]>([]);
  const [cartItemCount, setCartItemCount] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('recommended');
  // U2: browse shops (client-side) or produce (server-side search).
  const [view, setView] = useState<'shops' | 'produce'>('shops');
  // Favourite farms (U4): listed first. Empty when signed out.
  const [followed, setFollowed] = useState<Set<number>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadMerchants = async () => {
      try {
        const merchants = await fetchMerchants();
        if (cancelled) return;
        setFarmList(merchants.map(toFarmView));
        setIsLoading(false);

        // Logos and banners load after the list renders so cards appear immediately.
        const shopPages = await Promise.allSettled(
          merchants.map((m) => fetchMerchantShopPage(m.id))
        );
        if (cancelled) return;
        const images = new Map<number, { logo: string | null; banner: string | null }>();
        shopPages.forEach((result, i) => {
          if (result.status === 'fulfilled') {
            images.set(merchants[i].id, {
              logo: result.value.logo_url,
              banner: result.value.banner_image_url,
            });
          }
        });
        setFarmList((prev) =>
          prev.map((farm) => {
            const found = images.get(farm.merchantId);
            return found
              ? { ...farm, logoUrl: found.logo ?? farm.logoUrl, bannerUrl: found.banner ?? farm.bannerUrl }
              : farm;
          })
        );
      } catch {
        if (!cancelled) {
          setLoadError(true);
          setIsLoading(false);
        }
      }
    };

    const loadCart = async () => {
      try {
        const cart = await fetchMyCart();
        if (!cancelled && Array.isArray(cart.items)) {
          setCartItemCount(cart.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0));
        }
      } catch {

      }
    };

    void loadMerchants();
    fetchMyFollows()
      .then((ids) => { if (!cancelled) setFollowed(new Set(ids)); })
      .catch(() => { /* signed out: no favourites */ });
    void loadCart();

    return () => {
      cancelled = true;
    };
  }, []);

  const activeFilters = useMemo(() => {
    return new Set(
      (searchParams.get("filters") ?? "").split(",").filter(Boolean)
    );
  }, [searchParams]);

  const filteredFarms = useMemo(() => {
    let result = farmList;

    if (activeFilters.has("Popular")) {
      result = result.filter((farm) => farm.rating >= 4.0);
    }
    if (activeFilters.has("Fast Delivery")) {
      result = result.filter(
        (farm) => farm.deliveryTimeDays !== null && farm.deliveryTimeDays <= 2
      );
    }

    const query = searchTerm.trim().toLowerCase();
    if (query) {
      result = result.filter(
        (farm) =>
          farm.name.toLowerCase().includes(query) ||
          (farm.category ?? '').toLowerCase().includes(query),
      );
    }

    const sorted = [...result];
    if (sortKey === 'rating') {
      sorted.sort((a, b) => b.rating - a.rating);
    } else if (sortKey === 'fastest') {
      sorted.sort((a, b) => (a.deliveryTimeDays ?? Infinity) - (b.deliveryTimeDays ?? Infinity));
    } else if (sortKey === 'fee') {
      sorted.sort((a, b) => a.deliveryFee - b.deliveryFee);
    }
    // Followed farms first, keeping the chosen order within each group (stable sort).
    sorted.sort((a, b) => Number(followed.has(b.merchantId)) - Number(followed.has(a.merchantId)));
    return sorted;
  }, [farmList, searchTerm, activeFilters, sortKey, followed]);

  const merchantCountLabel = plural(filteredFarms.length, t.browse.shopCountOne, t.browse.shopCountMany);
  const hasQuery = searchTerm.trim().length > 0;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerTitle}>
          <h1 className={styles.pageTitle}>{t.browse.title}</h1>
          {!isLoading && <span className={styles.merchantCount}>{merchantCountLabel}</span>}
        </div>

        <div className={styles.searchWrap}>
          <Search className={styles.searchIcon} size={18} aria-hidden />
          <input
            type="search"
            className={styles.searchInput}
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder={t.browse.searchPlaceholder}
            aria-label={t.browse.searchLabel}
          />
          {hasQuery && (
            <button
              type="button"
              className={styles.clearSearch}
              onClick={() => setSearchTerm('')}
              aria-label={t.browse.clearSearch}
            >
              <X size={16} />
            </button>
          )}
        </div>

        <Link href="/cart" className={styles.cartButton} aria-label={fmt(t.browse.cartAria, { count: cartItemCount })}>
          <ShoppingCart size={18} aria-hidden />
          <span className={styles.cartLabel}>{t.browse.cart}</span>
          {cartItemCount > 0 && <span className={styles.cartBadge}>{cartItemCount}</span>}
        </Link>
      </header>

      <div className={styles.viewTabs} role="tablist">
        {(['shops', 'produce'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            className={`${styles.viewTab} ${view === v ? styles.viewTabActive : ''}`}
            onClick={() => setView(v)}
          >
            {v === 'shops' ? t.produceSearch.tabShops : t.produceSearch.tabProduce}
          </button>
        ))}
      </div>

      {view === 'produce' ? (
        <ProduceResults query={searchTerm} />
      ) : (
      <>
      <div className={styles.toolbar}>
        <div className={styles.activeFilters}>
          {Array.from(activeFilters).map((filter) => (
            <span key={filter} className={styles.filterTag}>{filter}</span>
          ))}
        </div>
        <label className={styles.sortLabel}>
          {t.browse.sortBy}
          <select
            className={styles.sortSelect}
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as SortKey)}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{t.browse[option.label]}</option>
            ))}
          </select>
        </label>
      </div>

      {isLoading ? (
        <section className={styles.farmGrid} aria-busy="true">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className={`${styles.farmCard} ${styles.skeletonCard}`}>
              <div className={styles.skeletonImage} />
              <div className={styles.cardContent}>
                <div className={styles.skeletonLine} />
                <div className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
              </div>
            </div>
          ))}
        </section>
      ) : loadError ? (
        <section className={styles.emptyState}>
          <Store size={32} className={styles.emptyIcon} aria-hidden />
          <h2>{t.browse.loadErrorTitle}</h2>
          <p>{t.browse.loadErrorBody}</p>
          <button type="button" className={styles.emptyAction} onClick={() => window.location.reload()}>
            {t.browse.retry}
          </button>
        </section>
      ) : filteredFarms.length === 0 ? (
        <section className={styles.emptyState}>
          <Store size={32} className={styles.emptyIcon} aria-hidden />
          <h2>{farmList.length === 0 ? t.browse.emptyNoneTitle : t.browse.emptyNoMatchTitle}</h2>
          <p>{farmList.length === 0 ? t.browse.emptyNoneBody : t.browse.emptyNoMatchBody}</p>
          {hasQuery && (
            <button type="button" className={styles.emptyAction} onClick={() => setSearchTerm('')}>
              {t.browse.clearSearch}
            </button>
          )}
        </section>
      ) : (
        <section className={styles.farmGrid}>
          {filteredFarms.map((farm) => (
            <Link
              key={farm.merchantId}
              href={`/merchant/${farm.merchantId}`}
              className={styles.farmCard}
            >
              <div className={styles.cardImage}>
                {farm.bannerUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={farm.bannerUrl} alt="" className={styles.cardBanner} loading="lazy" />
                )}
                <span className={styles.categoryChip}>{farm.category ?? t.browse.defaultCategory}</span>
              </div>

              <div className={styles.cardContent}>
                <div className={styles.cardAvatar} aria-hidden>
                  {farm.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={farm.logoUrl} alt="" className={styles.cardAvatarImg} loading="lazy" />
                  ) : (
                    <span className={styles.cardInitials}>{getInitials(farm.name)}</span>
                  )}
                </div>
                <div className={styles.cardTitleRow}>
                  <h3 className={styles.cardTitle}>{farm.name}</h3>
                  {followed.has(farm.merchantId) && <span className={styles.followTag}>{t.follow.badge}</span>}
                  {farm.rating > 0 && (
                    <span className={styles.rating}>
                      <Star size={13} aria-hidden />
                      {farm.rating.toFixed(1)}
                    </span>
                  )}
                </div>
                <div className={styles.cardMeta}>
                  <span className={styles.metaItem}>
                    <Clock size={13} aria-hidden />
                    {formatDeliveryTime(farm.deliveryTimeDays, t)}
                  </span>
                  <span className={styles.metaItem}>
                    <Truck size={13} aria-hidden />
                    {farm.deliveryFee > 0 ? fmt(t.browse.deliveryFee, { fee: farm.deliveryFee }) : t.browse.freeDelivery}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </section>
      )}
      </>
      )}
    </div>
  );
}

export default function Order() {
  const { t } = useLanguage();
  return (
    <Suspense fallback={<PageLoader label={t.browse.loading} />}>
      <OrderContent />
    </Suspense>
  );
}
