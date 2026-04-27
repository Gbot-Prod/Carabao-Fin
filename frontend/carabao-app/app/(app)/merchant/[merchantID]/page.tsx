'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import styles from '../page.module.css';
import { fetchMerchantById, fetchMyCart, replaceMyCart, type CartItem, type Merchant, type Produce } from '@/util/api';

export default function MerchantDetailPage() {
  const params = useParams<{ merchantID?: string }>();
  const merchantID = Number(params?.merchantID ?? '0');
  const hasValidMerchantId = Number.isFinite(merchantID) && merchantID > 0;

  const [merchant, setMerchant] = useState<Merchant | undefined>(undefined);
  const [error, setError] = useState<string | null>(hasValidMerchantId ? null : 'Invalid merchant ID.');

  useEffect(() => {
    if (!hasValidMerchantId) return;

    const loadMerchant = async () => {
      try {
        const found = await fetchMerchantById(merchantID);
        setMerchant(found);
      } catch {
        setError('Unable to load merchant profile right now.');
        setMerchant(undefined);
      }
    };

    void loadMerchant();
  }, [hasValidMerchantId, merchantID]);

  const produces = merchant?.produces ?? [];

  const [addingId, setAddingId] = useState<number | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  const handleAddToCart = async (produce: Produce) => {
    if (addingId !== null) return;
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
                quantity: 1,
                price: produce.price,
              },
            ];

      await replaceMyCart(updated);
      setNotification(produce.name ?? 'Item');
      setTimeout(() => setNotification(null), 2500);
    } catch {
      // silently fail — cart page will show current state
    } finally {
      setAddingId(null);
    }
  };

  if (!merchant && !error) {
    return <div className={styles.page}><p>Loading…</p></div>;
  }

  return (
    <div className={styles.page}>
      {notification && (
        <div style={{
          position: 'fixed', bottom: '1.5rem', right: '1.5rem',
          background: '#166534', color: '#fff',
          padding: '0.75rem 1.25rem', borderRadius: 10,
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 1000,
          fontSize: '0.9rem', fontWeight: 500,
        }}>
          <span>&#10003; {notification} added to cart</span>
          <Link href="/cart" style={{ color: '#86efac', textDecoration: 'underline', whiteSpace: 'nowrap' }}>
            View Cart
          </Link>
        </div>
      )}

      {error && <p>{error}</p>}

      {merchant && (
        <>
          <header className={styles.merchantHeader}>
            <div className={styles.merchantInfo}>
              <h1 className={styles.merchantName}>{merchant.merchant_name}</h1>
              <p className={styles.merchantLocation}>Location: {merchant.location ?? 'Not specified'}</p>
              <p className={styles.merchantDesc}>
                Fresh produce directly from our farm to your table.
              </p>

              <div className={styles.details}>
                <div className={styles.detailItem}>
                  <span className={styles.label}>Rating</span>
                  <span className={styles.value}>{merchant.rating ?? 'N/A'}</span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.label}>Delivery</span>
                  <span className={styles.value}>{merchant.delivery_time ? `${merchant.delivery_time} day(s)` : 'N/A'}</span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.label}>Hours</span>
                  <span className={styles.value}>{merchant.operating_hours ?? 'Not available'}</span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.label}>Contact</span>
                  <span className={styles.value}>{merchant.contact_number}</span>
                </div>
              </div>
            </div>
          </header>

          <section className={styles.productsSection}>
            <h2>Available Produce</h2>

            <div className={styles.productsGrid}>
              {produces.map((produce) => (
                <article key={produce.id} className={styles.productCard}>
                  <div className={styles.productBody}>
                    <h3>{produce.name ?? 'Unnamed Produce'}</h3>
                    {produce.description && <p className={styles.produceDesc}>{produce.description}</p>}
                    <p className={styles.price}>₱{produce.price} / {produce.unit}</p>
                    <button
                      className={styles.addBtn}
                      disabled={addingId === produce.id}
                      onClick={() => void handleAddToCart(produce)}
                    >
                      {addingId === produce.id ? 'Adding…' : 'Add to Cart'}
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
