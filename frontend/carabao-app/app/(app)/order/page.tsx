"use client";

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import styles from './page.module.css';
import { fetchMerchants, fetchMyCart, replaceMyCart, type CartItem } from '@/util/api';

type FarmView = {
  merchantId: number | null;
  name: string;
  rating: number;
  reviews: string;
  time: string;
  deliveryTimeDays: number | null;
  badge: string;
  category: string;
  deliveryFee: number;
  promo: string;
  image: string;
};

const toFarmView = (merchant: Awaited<ReturnType<typeof fetchMerchants>>[number]): FarmView => ({
  merchantId: merchant.id,
  name: merchant.merchant_name,
  rating: merchant.rating ?? 0,
  reviews: '(0)',
  time: merchant.delivery_time ? `${merchant.delivery_time} Days` : 'N/A',
  deliveryTimeDays: merchant.delivery_time ?? null,
  badge: '₱₱',
  category: merchant.location ?? 'Farm Goods',
  deliveryFee: merchant.delivery_price ?? 0,
  promo: 'Fresh produce',
  image: '/images/farms/dole.jpg',
});


function OrderContent() {
  const searchParams = useSearchParams();
  const [farmList, setFarmList] = useState<FarmView[]>([]);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isAddingByFarm, setIsAddingByFarm] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const buildItemId = (farmName: string) => farmName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  useEffect(() => {
    const loadData = async () => {
      try {
        const merchants = await fetchMerchants();
        if (merchants.length > 0) {
          setFarmList(merchants.map(toFarmView));
        }
      } catch {

      }

      try {
        const cart = await fetchMyCart();
        if (Array.isArray(cart.items)) {
          setCartItems(
            cart.items.map((item) => ({
              id: String(item.id),
              farm: item.farm,
              produce: item.produce,
              unit: item.unit,
              quantity: Number(item.quantity) || 0,
              price: Number(item.price) || 0,
            })),
          );
        }
      } catch {

      }
    };

    void loadData();
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
          farm.category.toLowerCase().includes(query) ||
          farm.promo.toLowerCase().includes(query),
      );
    }

    return result;
  }, [farmList, searchTerm, activeFilters]);

  const cartItemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const merchantCountLabel = `${filteredFarms.length} ${filteredFarms.length === 1 ? 'merchant' : 'merchants'}`;

  const handleAddToCart = async (farm: FarmView) => {
    const itemId = buildItemId(farm.name);
    setIsAddingByFarm((prev) => ({ ...prev, [itemId]: true }));

    const existingItem = cartItems.find((item) => item.id === itemId);
    const updatedItems: CartItem[] = existingItem
      ? cartItems.map((item) =>
        item.id === itemId ? { ...item, quantity: item.quantity + 1 } : item,
      )
      : [
        ...cartItems,
        {
          id: itemId,
          farm: farm.name,
          produce: `${farm.name} Produce Bundle`,
          unit: 'bundle',
          quantity: 1,
          price: farm.deliveryFee > 0 ? farm.deliveryFee : 120,
        },
      ];

    try {
      await replaceMyCart(updatedItems);
      setCartItems(updatedItems);
      setFeedback(`${farm.name} added to cart.`);
    } catch {
      setFeedback('Unable to add item to cart right now.');
    } finally {
      setIsAddingByFarm((prev) => ({ ...prev, [itemId]: false }));
    }
  };

  return (
    <div className={styles.container}>
      <section className={styles.hero}>
        <div>
          <p className={styles.heroEyebrow}>Fresh from local farms</p>
          <h1 className={styles.heroTitle}>Order From Verified Merchants</h1>
          <p className={styles.heroSubtitle}>
            Browse available merchants, open each store page, and add produce bundles to your cart.
          </p>
        </div>
        <div className={styles.heroActions}>
          <Link href="/cart" className={styles.cartLink}>
            Open Cart ({cartItemCount})
          </Link>
          <span className={styles.merchantCount}>{merchantCountLabel}</span>
        </div>
      </section>

      <section className={styles.controlsRow}>
        <label className={styles.searchWrap}>
          <span className={styles.searchLabel}>Find a merchant</span>
          <input
            type="search"
            className={styles.searchInput}
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search by name or location"
          />
        </label>
      </section>

      {feedback && <p className={styles.feedback}>{feedback}</p>}

      <section className={styles.farmGrid}>
        {filteredFarms.map((farm, index) => {
          const itemId = buildItemId(farm.name);
          const uniqueKey = farm.merchantId ? `merchant-${farm.merchantId}` : `farm-${index}`;
          const merchantHref = farm.merchantId ? `/merchant/${farm.merchantId}` : '/merchant';

          return (
            <article key={uniqueKey} className={styles.farmCard}>
              <div
                className={styles.cardImage}
                style={{
                  backgroundImage: `linear-gradient(165deg, rgba(11, 78, 36, 0.15), rgba(11, 78, 36, 0.6)), url(${farm.image})`,
                }}
              >
                <span className={styles.badge}>{farm.badge}</span>
                <span className={styles.categoryChip}>{farm.category}</span>
              </div>

              <div className={styles.cardContent}>
                <h3>{farm.name}</h3>
                <div className={styles.cardMeta}>
                  <span>Rating: {farm.rating.toFixed(1)}</span>
                  <span>•</span>
                  <span>{farm.time}</span>
                </div>
                <p className={styles.deliveryText}>Delivery Fee: ₱{farm.deliveryFee}</p>
                <p className={styles.promoText}>{farm.promo}</p>

                <div className={styles.cardActions}>
                  <Link href={merchantHref} className={styles.viewStoreButton}>
                    Visit Merchant
                  </Link>
                  <button
                    type="button"
                    className={styles.addToCartButton}
                    onClick={() => void handleAddToCart(farm)}
                    disabled={!!isAddingByFarm[itemId]}
                  >
                    {isAddingByFarm[itemId] ? 'Adding...' : 'Add Bundle'}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {filteredFarms.length === 0 && (
        <section className={styles.emptyState}>
          <h2>No merchants match your search</h2>
          <p>Try a different merchant name or clear the search field.</p>
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
