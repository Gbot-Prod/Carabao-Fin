// CF-0112: a farm's public reviews on the farm screen (web farms/[merchantID]).
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { api } from '../lib/api';
import {
  farmReplyLabel, hasMoreReviews, mergeReviews, REVIEWS_FIRST_PAGE, REVIEWS_MORE_PAGE, reviewSummary, shownReply, stars, wasEdited,
  type MerchantReviews, type PublicReview,
} from '../lib/reviews';
import { Colors, Spacing, Radius, FontSize } from '../lib/theme';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function FarmReviews({ merchantId, farmName }: { merchantId: number; farmName?: string | null }) {
  const [summary, setSummary] = useState<Pick<MerchantReviews, 'rating' | 'rating_count'> | null>(null);
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let active = true;
    api.reviews
      .forMerchant(merchantId, 0, REVIEWS_FIRST_PAGE)
      .then((res) => {
        if (!active) return;
        setSummary({ rating: res.rating, rating_count: res.rating_count });
        setReviews(res.reviews);
      })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [merchantId]);

  const loadMore = () => {
    setLoadingMore(true);
    api.reviews
      .forMerchant(merchantId, reviews.length, REVIEWS_MORE_PAGE)
      .then((res) => {
        setSummary({ rating: res.rating, rating_count: res.rating_count });
        setReviews((prev) => mergeReviews(prev, res.reviews));
      })
      .catch(() => { /* the button stays; tap again */ })
      .finally(() => setLoadingMore(false));
  };

  if (failed) return null; // reviews are extra: the shop works without them
  if (!summary) return <ActivityIndicator style={{ marginVertical: Spacing.lg }} color={Colors.primary} />;

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Reviews</Text>
      <Text style={styles.summary} accessibilityLiveRegion="polite">
        {summary.rating_count > 0 && summary.rating !== null ? `${stars(summary.rating)}  ` : ''}
        {reviewSummary(summary.rating, summary.rating_count)}
      </Text>
      {reviews.map((r) => (
        <View key={r.id} style={styles.card}>
          <View style={styles.cardTop}>
            <Text style={styles.stars} accessibilityLabel={`${r.rating} out of 5 stars`}>{stars(r.rating)}</Text>
            <Text style={styles.meta}>
              {formatDate(r.created_at)}{wasEdited(r) ? ' · edited' : ''}
            </Text>
          </View>
          {r.comment ? <Text style={styles.comment}>{r.comment}</Text> : null}
          <Text style={styles.meta}>{r.reviewer_name}</Text>
          {shownReply(r) ? (
            // CF-0133 (M55): the farm's public reply, as on web FarmReviews.
            <View style={styles.reply}>
              <Text style={styles.replyFrom}>{farmReplyLabel(farmName)}</Text>
              <Text style={styles.comment}>{shownReply(r)}</Text>
            </View>
          ) : null}
        </View>
      ))}
      {hasMoreReviews(reviews.length, summary.rating_count) && (
        <TouchableOpacity style={styles.more} onPress={loadMore} disabled={loadingMore} accessibilityRole="button">
          {loadingMore ? (
            <ActivityIndicator color={Colors.primary} />
          ) : (
            <Text style={styles.moreText}>Show more reviews</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, gap: Spacing.sm },
  title: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  summary: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600' },
  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.md, gap: 4,
    borderWidth: 1, borderColor: Colors.border,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stars: { fontSize: FontSize.md, color: Colors.warning },
  comment: { fontSize: FontSize.sm, color: Colors.text, lineHeight: 20 },
  meta: { fontSize: FontSize.xs, color: Colors.textMuted },
  reply: {
    marginTop: Spacing.xs, padding: Spacing.sm, gap: 2, borderRadius: Radius.md,
    backgroundColor: Colors.offWhite, borderLeftWidth: 3, borderLeftColor: Colors.primary,
  },
  replyFrom: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.primary },
  more: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
});
