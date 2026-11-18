'use client';

// CF-0046 (B48): public reviews of a farm, with the farm's reply, paged.

import { useCallback, useEffect, useState } from 'react';
import styles from './FarmReviews.module.css';
import SkeletonList, { LoadError } from '@/components/Skeleton/Skeleton';
import { useLanguage } from '@/lib/i18n/LanguageProvider';
import { fmt } from '@/lib/i18n/format';
import { REVIEWS_PAGE_SIZE, appendReviews, hasMoreReviews, reviewDate, starsText } from '@/lib/farm-reviews';
import { fetchMerchantReviews, type PublicReview } from '@/util/api/reviews';

type Props = { merchantId: number; farmName: string };

export default function FarmReviews({ merchantId, farmName }: Props) {
  const { t, lang } = useLanguage();
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [total, setTotal] = useState(0);
  const [rating, setRating] = useState<number | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);

  const loadFirst = useCallback(async () => {
    setState('loading');
    try {
      const page = await fetchMerchantReviews(merchantId, { limit: REVIEWS_PAGE_SIZE, offset: 0 });
      setReviews(page.reviews);
      setTotal(page.total ?? page.reviews.length);
      setRating(page.rating);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [merchantId]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  const loadMore = async () => {
    setLoadingMore(true);
    setMoreError(false);
    try {
      const page = await fetchMerchantReviews(merchantId, { limit: REVIEWS_PAGE_SIZE, offset: reviews.length });
      setReviews((prev) => appendReviews(prev, page.reviews));
      setTotal(page.total ?? total);
    } catch {
      setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <section className={styles.section} aria-labelledby="farm-reviews-title">
      <div className={styles.head}>
        <h2 id="farm-reviews-title">{t.shop.reviewsTitle}</h2>
        {state === 'ready' && total > 0 && (
          <p className={styles.summary}>
            {fmt(t.shop.reviewsSummary, { rating: rating != null ? rating.toFixed(1) : t.shop.na, count: total })}
          </p>
        )}
      </div>

      {state === 'loading' && <SkeletonList label={t.shop.reviewsLoading} rows={2} />}
      {state === 'error' && (
        <LoadError message={t.shop.reviewsError} onRetry={() => void loadFirst()} retryLabel={t.shop.tryAgain} />
      )}
      {state === 'ready' && reviews.length === 0 && <p className={styles.empty}>{t.shop.noReviews}</p>}

      {state === 'ready' && reviews.length > 0 && (
        <ul className={styles.list}>
          {reviews.map((review) => (
            <li key={review.id} className={styles.item}>
              <div className={styles.meta}>
                <span className={styles.stars} aria-label={fmt(t.shop.starsLabel, { n: review.rating })}>
                  {starsText(review.rating)}
                </span>
                <span className={styles.name}>{review.reviewer_name}</span>
                <time className={styles.date} dateTime={review.created_at}>{reviewDate(review.created_at, lang)}</time>
              </div>
              {review.comment && <p className={styles.comment}>{review.comment}</p>}
              {review.merchant_reply && (
                <div className={styles.reply}>
                  <p className={styles.replyFrom}>{fmt(t.shop.farmReply, { farm: farmName })}</p>
                  <p className={styles.comment}>{review.merchant_reply}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {state === 'ready' && hasMoreReviews(reviews.length, total) && (
        <div className={styles.more}>
          {moreError && <p role="alert" className={styles.moreError}>{t.shop.reviewsError}</p>}
          <button type="button" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? t.shop.loadingMore : t.shop.showMoreReviews}
          </button>
        </div>
      )}
    </section>
  );
}
