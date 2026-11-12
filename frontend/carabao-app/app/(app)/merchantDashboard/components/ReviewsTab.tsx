import { useCallback, useEffect, useRef, useState } from "react";
import styles from "../page.module.css";
import PageLoader from "@/components/PageLoader/PageLoader";
import { fetchMyMerchantReviews, type MyMerchantReviews, type MyMerchantReviewsQuery, type Review } from "@/util/api";
import { formatDate } from "../lib/format";

type ReviewFilter = "all" | "commented" | "critical" | "1" | "2" | "3" | "4" | "5";

const PAGE_SIZE = 20;

const FILTER_CHIPS: [ReviewFilter, string][] = [
  ["all", "All"],
  ["commented", "With comments"],
  ["critical", "1–2★"],
];

const filterQuery = (filter: ReviewFilter): MyMerchantReviewsQuery => {
  if (filter === "all") return {};
  if (filter === "commented") return { hasComment: true };
  if (filter === "critical") return { ratings: [1, 2] };
  return { ratings: [Number(filter)] };
};

const renderStars = (rating: number) => "★".repeat(rating) + "☆".repeat(Math.max(0, 5 - rating));

const wasEdited = (review: Review) =>
  new Date(review.updated_at).getTime() - new Date(review.created_at).getTime() > 60_000;

type Props = {
  /** A review's "View order" link. */
  onViewOrder: (orderId: number) => void;
};

export default function ReviewsTab({ onViewOrder }: Props) {
  const [summary, setSummary] = useState<MyMerchantReviews | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [loadedFor, setLoadedFor] = useState<ReviewFilter | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Drops responses from a filter the merchant has already clicked away from.
  const requestRef = useRef(0);

  const load = useCallback(async (f: ReviewFilter, offset: number) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMyMerchantReviews({ ...filterQuery(f), limit: PAGE_SIZE, offset });
      if (requestId !== requestRef.current) return;
      setSummary(data);
      setReviews((prev) => (offset === 0 ? data.reviews : [...prev, ...data.reviews]));
      setLoadedFor(f);
    } catch {
      if (requestId === requestRef.current) setError("Failed to load reviews. Please try again.");
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loadedFor === filter) return;
    void load(filter, 0);
  }, [filter, loadedFor, load]);

  const isCurrent = loadedFor === filter;

  return (
    <div className={styles.ordersLayout}>
      {summary && (
        <div className={`${styles.panel} ${styles.reviewSummary}`}>
          <div className={styles.reviewAverage}>
            <strong className={styles.reviewAverageValue}>
              {summary.rating == null ? "—" : Number(summary.rating).toFixed(1)}
            </strong>
            {summary.rating != null && (
              <span className={styles.reviewStars} aria-hidden="true">
                {renderStars(Math.round(summary.rating))}
              </span>
            )}
            <span className={styles.kpiSub}>
              {summary.rating_count} review{summary.rating_count === 1 ? "" : "s"} ·{" "}
              {summary.with_comment_count} with comments
            </span>
          </div>
          <div className={styles.reviewBreakdown}>
            {[5, 4, 3, 2, 1].map((stars) => {
              const count = summary.rating_breakdown[String(stars)] ?? 0;
              const pct = summary.rating_count ? (count / summary.rating_count) * 100 : 0;
              const key = String(stars) as ReviewFilter;
              return (
                <button
                  key={stars}
                  type="button"
                  className={`${styles.breakdownRow} ${filter === key ? styles.breakdownRowActive : ""}`}
                  disabled={count === 0}
                  onClick={() => setFilter(filter === key ? "all" : key)}
                  aria-label={`Show ${stars}-star reviews (${count})`}
                >
                  <span className={styles.breakdownLabel}>{stars}★</span>
                  <span className={styles.breakdownTrack}>
                    <span className={styles.breakdownFill} style={{ width: `${pct}%` }} />
                  </span>
                  <span className={styles.breakdownCount}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className={styles.ordersHeader}>
        <h2 className={`${styles.sectionTitle} ${styles.flush}`}>Customer Reviews</h2>
        <div className={styles.orderFilterRow}>
          {FILTER_CHIPS.map(([value, label]) => (
            <button
              key={value}
              className={`${styles.filterChip} ${filter === value ? styles.filterChipActive : ""}`}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
          {/^[1-5]$/.test(filter) && (
            <button
              className={`${styles.filterChip} ${styles.filterChipActive}`}
              onClick={() => setFilter("all")}
              aria-label="Clear star filter"
            >
              {filter}★ only ×
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className={styles.reviewError}>
          <p className={`${styles.emptyText} ${styles.errorText}`}>{error}</p>
          <button className={styles.secondaryBtn} onClick={() => void load(filter, 0)}>Retry</button>
        </div>
      )}
      {loading && !isCurrent && <PageLoader variant="compact" label="Loading reviews…" />}
      {!loading && !error && summary?.rating_count === 0 && (
        <p className={styles.emptyText}>No reviews yet. Buyers can rate an order once it&apos;s delivered.</p>
      )}
      {!loading && !error && !!summary?.rating_count && reviews.length === 0 && (
        <p className={styles.emptyText}>No reviews match this filter.</p>
      )}

      {isCurrent && reviews.length > 0 && (
        <div className={styles.ordersList}>
          {reviews.map((review) => (
            <article key={review.id} className={styles.reviewCard}>
              <div className={styles.reviewCardHeader}>
                <span className={styles.reviewStars} aria-label={`${review.rating} out of 5 stars`}>
                  {renderStars(review.rating)}
                </span>
                <span className={styles.orderBuyerName}>{review.reviewer_name}</span>
                <span className={styles.orderDate}>
                  {formatDate(review.created_at)}
                  {wasEdited(review) && " · edited"}
                </span>
              </div>
              {review.comment ? (
                <p className={styles.reviewComment}>{review.comment}</p>
              ) : (
                <p className={styles.reviewNoComment}>No comment left.</p>
              )}
              {review.order_id != null && (
                <button
                  type="button"
                  className={styles.reviewOrderLink}
                  onClick={() => onViewOrder(review.order_id as number)}
                >
                  View order #{review.order_id} →
                </button>
              )}
            </article>
          ))}
        </div>
      )}

      {summary && isCurrent && reviews.length < summary.total && (
        <div className={styles.overviewActions}>
          <button className={styles.secondaryBtn} disabled={loading} onClick={() => void load(filter, reviews.length)}>
            {loading ? "Loading…" : `Load more (${summary.total - reviews.length} left)`}
          </button>
        </div>
      )}
    </div>
  );
}
