'use client';

import React from 'react';
import Image from 'next/image';
import styles from './orderCard.module.css';

export interface Order {
  merchant: string;
  shipped: boolean;
  dateBought: string;
  timeOfArrival: string;
  deliveryFee: number;
  image: string;
}

interface OrderCardProps {
  order: Order;
  onClick?: () => void;
  isSelected?: boolean;
}

export default function OrderCard({ order, onClick, isSelected = false }: OrderCardProps) {
  const deliveryFee = new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(order.deliveryFee);

  const initials = order.merchant.slice(0, 2).toUpperCase();

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={isSelected}
        className={`${styles.card} ${isSelected ? styles.selected : ''}`}
      >
        <div className={styles.row}>
          {order.image ? (
            <Image
              className={styles.thumb}
              src={order.image}
              alt={order.merchant}
              width={48}
              height={48}
            />
          ) : (
            <div className={`${styles.thumb} ${styles.initials}`}>
              {initials}
            </div>
          )}
          <div className={styles.info}>
            <p className={styles.merchant}>{order.merchant}</p>
            <p className={styles.bought}>Bought {order.dateBought}</p>
          </div>
          <span className={`${styles.badge} ${order.shipped ? styles.shipped : styles.notShipped}`}>
            {order.shipped ? 'Shipped' : 'Not shipped'}
          </span>
        </div>

        <div className={styles.footer}>
          <span>
            ETA <span className={styles.value}>{order.shipped ? order.timeOfArrival : 'Pending'}</span>
          </span>
          <span>
            Fee <span className={styles.value}>{deliveryFee}</span>
          </span>
        </div>
      </button>
    </li>
  );
}
