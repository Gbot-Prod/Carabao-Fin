"use client";

import { useEffect, useState } from 'react';
import styles from './page.module.css';
import FarmCard from './components/farmCard'
import { farms } from './data/farms';
import { fetchMerchants } from '@/util/api';

type FarmView = (typeof farms)[number];

const toFarmView = (merchant: Awaited<ReturnType<typeof fetchMerchants>>[number]): FarmView => ({
  name: merchant.merchant_name,
  rating: merchant.rating ?? 0,
  reviews: '(0)',
  time: merchant.delivery_time ? `${merchant.delivery_time} Days` : 'N/A',
  badge: '₱₱',
  category: merchant.location ?? 'Farm Goods',
  deliveryFee: merchant.delivery_price ?? 0,
  promo: 'Fresh produce',
  image: '/images/farms/dole.jpg',
});

export default function Order() {
  const [farmList, setFarmList] = useState<FarmView[]>(farms);

  useEffect(() => {
    const loadMerchants = async () => {
      try {
        const merchants = await fetchMerchants();
        if (merchants.length > 0) {
          setFarmList(merchants.map(toFarmView));
        }
      } catch {
        // Keep local fallback data when API is unavailable.
      }
    };

    void loadMerchants();
  }, []);

  return (
    <div className={styles.container}>
      <section className={styles.section}>
        <h2>Order</h2>
        <div className={styles.farmGrid}>
          {farmList.map((farm, index) => (
            <FarmCard key={index} farm={farm} />
          ))}
        </div>
      </section>
    </div>
  );
}
