"use client";

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Clock, Search, ShoppingCart, Star, Store, Truck, X } from 'lucide-react';
import styles from './page.module.css';
import { fetchMerchants, fetchMerchantShopPage, fetchMyCart } from '@/util/api';

type FarmView = {
  merchantId: number;
  name: string;
  rating: number;
  deliveryTimeDays: number | null;
  category: string;
  deliveryFee: number;
  logoUrl: string | null;
};

type SortKey = 'recommended' | 'rating' | 'fastest' | 'fee';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'rating', label: 'Top rated' },
  { value: 'fastest', label: 'Fastest delivery' },
  { value: 'fee', label: 'Lowest delivery fee' },
];

const toFarmView = (merchant: Awaited<ReturnType<typeof fetchMerchants>>[number]): FarmView => ({
  merchantId: merchant.id,
  name: merchant.merchant_name,
  rating: merchant.rating ?? 0,
  deliveryTimeDays: merchant.delivery_time ?? null,
  category: merchant.category ?? 'Farm Goods',
  deliveryFee: merchant.delivery_price ?? 0,
  logoUrl: null,
});

const formatDeliveryTime = (days: number | null) => {
  if (days === null) return 'Varies';
  return `${days} ${days === 1 ? 'day' : 'days'}`;
};

const getInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');

function OrderContent() {
  const searchParams = useSearchParams();
  const [farmList, setFarmList] = useState<FarmView[]>([]);
  const [cartItemCount, setCartItemCount] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('recommended');
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

        // Logos load after the list renders so cards appear immediately.
        const shopPages = await Promise.allSettled(
          merchants.map((m) => fetchMerchantShopPage(m.id))
        );
        if (cancelled) return;
        const logos = new Map<number, string | null>();
        shopPages.forEach((result, i) => {
          if (result.status === 'fulfilled') logos.set(merchants[i].id, result.value.logo_url);
        });
        setFarmList((prev) =>
          prev.map((farm) => ({ ...farm, logoUrl: logos.get(farm.merchantId) ?? farm.logoUrl }))
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
          farm.category.toLowerCase().includes(query),
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
    return sorted;
  }, [farmList, searchTerm, activeFilters, sortKey]);

  const merchantCountLabel = `${filteredFarms.length} ${filteredFarms.length === 1 ? 'shop' : 'shops'}`;
  const hasQuery = searchTerm.trim().length > 0;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerTitle}>
          <h1 className={styles.pageTitle}>Browse Shops</h1>
          {!isLoading && <span className={styles.merchantCount}>{merchantCountLabel}</span>}
        </div>

        <div className={styles.searchWrap}>
          <Search className={styles.searchIcon} size={18} aria-hidden />
          <input
            type="search"
            className={styles.searchInput}
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search shops or categories…"
            aria-label="Search shops"
          />
          {hasQuery && (
            <button
              type="button"
              className={styles.clearSearch}
              onClick={() => setSearchTerm('')}
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <Link href="/cart" className={styles.cartButton} aria-label={`Cart, ${cartItemCount} items`}>
          <ShoppingCart size={18} aria-hidden />
          <span className={styles.cartLabel}>Cart</span>
          {cartItemCount > 0 && <span className={styles.cartBadge}>{cartItemCount}</span>}
        </Link>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.activeFilters}>
          {Array.from(activeFilters).map((filter) => (
            <span key={filter} className={styles.filterTag}>{filter}</span>
          ))}
        </div>
        <label className={styles.sortLabel}>
          Sort by
          <select
            className={styles.sortSelect}
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as SortKey)}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
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
          <h2>Couldn&apos;t load shops</h2>
          <p>Check your connection and try again.</p>
          <button type="button" className={styles.emptyAction} onClick={() => window.location.reload()}>
            Retry
          </button>
        </section>
      ) : filteredFarms.length === 0 ? (
        <section className={styles.emptyState}>
          <Store size={32} className={styles.emptyIcon} aria-hidden />
          <h2>{farmList.length === 0 ? 'No shops available yet' : 'No shops match your search'}</h2>
          <p>
            {farmList.length === 0
              ? 'Check back soon — new farms are joining Carabao.'
              : 'Try a different name or category, or adjust your filters.'}
          </p>
          {hasQuery && (
            <button type="button" className={styles.emptyAction} onClick={() => setSearchTerm('')}>
              Clear search
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
                {farm.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={farm.logoUrl} alt="" className={styles.cardLogo} loading="lazy" />
                ) : (
                  <span className={styles.cardInitials} aria-hidden>{getInitials(farm.name)}</span>
                )}
                <span className={styles.categoryChip}>{farm.category}</span>
              </div>

              <div className={styles.cardContent}>
                <div className={styles.cardTitleRow}>
                  <h3 className={styles.cardTitle}>{farm.name}</h3>
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
                    {formatDeliveryTime(farm.deliveryTimeDays)}
                  </span>
                  <span className={styles.metaItem}>
                    <Truck size={13} aria-hidden />
                    {farm.deliveryFee > 0 ? `₱${farm.deliveryFee} delivery` : 'Free delivery'}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}

export default function Order() {
  return (
    <Suspense>
      <OrderContent />
    </Suspense>
  );
}
