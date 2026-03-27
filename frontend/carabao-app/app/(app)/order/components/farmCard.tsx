'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { Farm } from '../data/farms';
import styles from './farmCard.module.css';

interface FarmCardProps {
  farm: Farm;
  onClick?: () => void;
}

export default function FarmCard({ farm, onClick }: FarmCardProps) {
  const [isFavorite, setIsFavorite] = useState(false);

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsFavorite(!isFavorite);
  };

  return (
    <div className={styles.farmCard} onClick={onClick}>
      <div className={styles.cardImage}>
        {farm.image && (
          <Image
            src={farm.image}
            alt={farm.name}
            fill
            style={{ objectFit: 'cover' }}
            sizes="300px"
          />
        )}
        <span className={styles.badge}>{farm.badge}</span>
        <button
          className={styles.favorite}
          onClick={handleFavoriteClick}
          aria-label="Toggle favorite"
        >
          {isFavorite ? '❤️' : '🤍'}
        </button>
      </div>

      <div className={styles.cardContent}>
        <h3>{farm.name}</h3>

        <div className={styles.cardMeta}>
          <span className={styles.rating}>
            ⭐ {farm.rating}
          </span>
          <span>{farm.reviews}</span>
        </div>

        <div className={styles.cardInfo}>
          <span>🕒 {farm.time}</span>
          <span>• {farm.category}</span>
        </div>

        <div className={styles.cardFooter}>
          <span>₱{farm.deliveryFee} delivery</span>
          {farm.promo && (
            <span className={styles.promo}>{farm.promo}</span>
          )}
        </div>
      </div>
    </div>
  );
}
