'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import styles from '../page.module.css';
import PageLoader from '@/components/PageLoader/PageLoader';
import { useLanguage } from '@/lib/i18n/LanguageProvider';
import { useAuth } from '@/hooks/useAuth';
import { useAuthPrompt } from '@/components/AuthPrompt/AuthPromptContext';
import { fetchMyFollows, followFarm, unfollowFarm } from '@/util/api/merchants';
import { fmt } from '@/lib/i18n/format';
import ReferencePriceHint, { useReferencePrices } from '@/components/ReferencePrice/ReferencePriceHint';
import { formatRequestedDate } from '@/app/(app)/merchantDashboard/lib/format';
import { fetchMerchantById, fetchMerchantShopPage, fetchMyCart, replaceMyCart, type CartItem, type Merchant, type Produce, type ShopPage } from '@/util/api';

export default function MerchantDetailPage() {
  const params = useParams<{ merchantID?: string }>();
  const merchantID = Number(params?.merchantID ?? '0');
  const hasValidMerchantId = Number.isFinite(merchantID) && merchantID > 0;
  const { t } = useLanguage();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { showPrompt } = useAuthPrompt();
  // Favourite farms (U4)
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  useEffect(() => {
    if (!isAuthenticated || !hasValidMerchantId) return;
    fetchMyFollows()
      .then((ids) => setFollowing(ids.includes(merchantID)))
      .catch(() => setFollowing(false));
  }, [isAuthenticated, hasValidMerchantId, merchantID]);
  const toggleFollow = async () => {
    if (!isAuthenticated) {
      showPrompt();
      return;
    }
    setFollowBusy(true);
    try {
      if (following) await unfollowFarm(merchantID);
      else await followFarm(merchantID);
      setFollowing(!following);
    } catch {
      // leave the button as it was
    } finally {
      setFollowBusy(false);
    }
  };
  // Market reference ranges (P1), fetched once and matched per card.
  const referencePrices = useReferencePrices();

  const [merchant, setMerchant] = useState<Merchant | undefined>(undefined);
  const [shopPage, setShopPage] = useState<ShopPage | null>(null);
  const [error, setError] = useState<string | null>(hasValidMerchantId ? null : 'Invalid merchant ID.');
  const merchantLocation = [
    merchant?.address,
    merchant?.barangay,
    merchant?.city,
    merchant?.province,
    merchant?.region,
  ]
  .filter(Boolean)
  .join(", ");

  useEffect(() => {
    if (!hasValidMerchantId) return;

    const loadMerchant = async () => {
      try {
        const [found, page] = await Promise.allSettled([
          fetchMerchantById(merchantID),
          fetchMerchantShopPage(merchantID),
        ]);
        if (found.status === 'fulfilled') setMerchant(found.value);
        else { setError('Unable to load merchant profile right now.'); setMerchant(undefined); }
        if (page.status === 'fulfilled') setShopPage(page.value);
      } catch {
        setError('Unable to load merchant profile right now.');
      }
    };

    void loadMerchant();
  }, [hasValidMerchantId, merchantID]);

  const produces = merchant?.produces ?? [];

  const [addingId, setAddingId] = useState<number | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const addingRef = useRef(false);
  

  const handleAddToCart = async (produce: Produce) => {
    if (addingRef.current) return;
    // The cart lives on the buyer's account: say so instead of failing silently (E4).
    if (!authLoading && !isAuthenticated) {
      showPrompt('cart');
      return;
    }
    addingRef.current = true;
    setAddingId(produce.id);

    try {
      const cart = await fetchMyCart();
      const existing: CartItem[] = Array.isArray(cart.items) ? cart.items : [];
      const itemId = String(produce.id);
      const idx = existing.findIndex((i) => i.id === itemId);

      const updated =
        idx >= 0
          ? existing.map((i, n) =>
              n === idx ? { ...i, quantity: i.quantity + 1 } : i,
            )
          : [
              ...existing,
              {
                id: itemId,
                farm: merchant?.merchant_name ?? '',
                produce: produce.name ?? 'Item',
                unit: produce.unit,
                // A first add starts at the listing's minimum order.
                quantity: produce.min_order_qty,
                price: produce.price,
                stock_quantity: produce.stock_quantity,
              },
            ];

      await replaceMyCart(updated);
      setNotification(produce.name ?? 'Item');
      setTimeout(() => setNotification(null), 2500);
    } catch {
      // silently fail — cart page will show current state
    } finally {
      addingRef.current = false;
      setAddingId(null);
    }
  };

  if (!merchant && !error) {
    return <PageLoader label={t.shop.loading} />;
  }

  return (
    <div className={styles.page}>
      {notification && (
        <div className={styles.cartToast} role="status">
          <span>&#10003; {fmt(t.shop.addedToCart, { name: notification })}</span>
          <Link href="/cart">
            {t.shop.viewCart}
          </Link>
        </div>
      )}

      {error && <p>{error}</p>}

      {merchant && (
        <>
          <header className={styles.merchantHeader}>
            {/* Banner */}
            {shopPage?.banner_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shopPage.banner_image_url} alt="" className={styles.shopBanner} />
            ) : (
              <div className={styles.shopBannerPlaceholder} />
            )}

            {/* Logo + info */}
            <div className={styles.merchantHeaderBody}>
              {shopPage?.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shopPage.logo_url} alt={merchant.merchant_name} className={styles.merchantImage} />
              ) : null}
              <div className={styles.merchantInfo}>
                <div className={styles.merchantNameRow}>
                  <h1 className={styles.merchantName}>{merchant.merchant_name}</h1>
                  <button
                    type="button"
                    className={`${styles.followBtn} ${following ? styles.followBtnOn : ''}`}
                    aria-pressed={following}
                    onClick={() => void toggleFollow()}
                    disabled={followBusy}
                    title={following ? t.follow.unfollow : undefined}
                  >
                    {following ? `✓ ${t.follow.following}` : `+ ${t.follow.follow}`}
                  </button>
                </div>
                <dl className={styles.ownerInfo}>
                  <div className={styles.ownerRow}>
                    <dt>{t.shop.owner}</dt>
                    <dd>{merchant.owner_name || t.shop.notProvided}</dd>
                  </div>
                  <div className={styles.ownerRow}>
                    <dt>{t.shop.contact}</dt>
                    <dd>
                      {merchant.contact_number ? (
                        <a href={`tel:${merchant.contact_number}`}>{merchant.contact_number}</a>
                      ) : (
                        t.shop.notProvided
                      )}
                    </dd>
                  </div>
                  {merchant.contact_email && (
                    <div className={styles.ownerRow}>
                      <dt>{t.shop.email}</dt>
                      <dd>
                        <a href={`mailto:${merchant.contact_email}`}>{merchant.contact_email}</a>
                      </dd>
                    </div>
                  )}
                </dl>
                <p className={styles.merchantLocation}>{fmt(t.shop.location, { place: merchantLocation || t.shop.notSpecified })}</p>
                {(shopPage?.description) && (
                  <p className={styles.merchantDesc}>{shopPage.description}</p>
                )}
                <div className={styles.details}>
                  <div className={styles.detailItem}>
                    <span className={styles.label}>{t.shop.rating}</span>
                    <span className={styles.value}>{merchant.rating ?? t.shop.na}</span>
                  </div>
                  <div className={styles.detailItem}>
                    <span className={styles.label}>{t.shop.delivery}</span>
                    <span className={styles.value}>{merchant.delivery_time ? fmt(t.shop.deliveryDays, { count: merchant.delivery_time }) : t.shop.na}</span>
                  </div>
                  <div className={styles.detailItem}>
                    <span className={styles.label}>{t.shop.hours}</span>
                    <span className={styles.value}>{merchant.operating_hours != null ? (typeof merchant.operating_hours === 'string' ? merchant.operating_hours : JSON.stringify(merchant.operating_hours)) : t.shop.notAvailable}</span>
                  </div>
                </div>
              </div>
            </div>
          </header>

          <section className={styles.productsSection}>
            <h2>{t.shop.availableProduce}</h2>

            <div className={styles.productsGrid}>
              {produces.map((produce) => (
                <article key={produce.id} className={styles.productCard}>
                  <div className={styles.productImage}>
                    {produce.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={produce.image_url} alt={produce.name ? `Photo of ${produce.name}` : 'Produce photo'} />
                    ) : null}
                    {produce.category && (
                      <span className={styles.badge}>{produce.category}</span>
                    )}
                  </div>
                  <div className={styles.productBody}>
                    <h3>{produce.name ?? t.shop.unnamedProduce}</h3>
                    {produce.description && <p className={styles.produceDesc}>{produce.description}</p>}
                    <p className={styles.freshness}>
                      {produce.harvest_date
                        ? fmt(t.shop.harvested, { date: formatRequestedDate(produce.harvest_date) })
                        : t.shop.harvestNotSet}
                      {produce.best_before && ` · ${fmt(t.shop.bestBefore, { date: formatRequestedDate(produce.best_before) })}`}
                    </p>
                    {produce.min_order_qty > 1 && (
                      <p className={styles.freshness}>{fmt(t.shop.minOrder, { qty: produce.min_order_qty })}</p>
                    )}
                    {produce.price_tiers.length > 0 && (
                      <p className={styles.freshness}>
                        {fmt(t.shop.bulk, {
                          tiers: produce.price_tiers
                            .map((tier) => fmt(t.shop.bulkTier, { qty: tier.min_qty, price: tier.unit_price }))
                            .join(' · '),
                        })}
                      </p>
                    )}
                    <p className={styles.price}>₱{produce.price} / {produce.unit_quantity && produce.unit_quantity !== 1 ? produce.unit_quantity : ""}{produce.unit}</p>
                    <ReferencePriceHint name={produce.name} unit={produce.unit} variant="card" prices={referencePrices} />
                    <button
                      className={styles.addBtn}
                      disabled={addingId === produce.id}
                      onClick={() => void handleAddToCart(produce)}
                    >
                      {addingId === produce.id ? t.shop.adding : t.shop.addToCart}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
