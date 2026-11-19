// src/screens/MerchantReviewsScreen.tsx
// CF-0119: the merchant's own reviews (web merchant shell "reviews" tab): summary,
// star breakdown, filters by stars and "with comment", paging. Replies (CF-0043)
// exist only on the web loop branch: M35.
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { api, ApiError } from '../lib/api';
import {
  breakdownRows, mergeReviews, MY_REVIEWS_PAGE, myReviewsQuery, reviewSummary, stars, toggleRating, wasEdited,
  type MyMerchantReviews, type MyReview, type MyReviewsFilter,
} from '../lib/reviews';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { ProtectedScreen } from '../components/ProtectedScreen';
import { SkeletonList, LoadError } from '../components/Skeleton';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

type Status = 'loading' | 'ready' | 'error' | 'notMerchant';

function Content() {
  const router = useRouter();
  const { token } = useAuth();
  const [filter, setFilter] = useState<MyReviewsFilter>({ ratings: [], hasComment: null });
  const [summary, setSummary] = useState<MyMerchantReviews | null>(null);
  const [reviews, setReviews] = useState<MyReview[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    api.merchants
      .myReviews(token, myReviewsQuery(filter, 0))
      .then((res) => {
        if (mine !== seq.current) return;
        setSummary(res);
        setReviews(res.reviews);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (mine !== seq.current) return;
        setStatus(err instanceof ApiError && err.status === 404 ? 'notMerchant' : 'error');
      })
      .finally(() => { if (mine === seq.current) setRefreshing(false); });
  }, [token, filter, attempt]);

  const loadMore = () => {
    if (!summary || loadingMore || reviews.length >= summary.total) return;
    const mine = seq.current;
    setLoadingMore(true);
    api.merchants
      .myReviews(token, myReviewsQuery(filter, reviews.length, MY_REVIEWS_PAGE))
      .then((res) => {
        if (mine !== seq.current) return;
        setSummary(res);
        setReviews((prev) => mergeReviews(prev, res.reviews) as MyReview[]);
      })
      .catch(() => { /* scroll again */ })
      .finally(() => setLoadingMore(false));
  };

  const header = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={24} color={Colors.text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Reviews</Text>
    </View>
  );

  if (status === 'notMerchant') {
    return (
      <SafeAreaView style={styles.root}>
        {header}
        <View style={styles.center}><Text style={styles.muted}>Reviews are for farm accounts. Set up your farm first.</Text></View>
      </SafeAreaView>
    );
  }
  if (status === 'error') {
    return (
      <SafeAreaView style={styles.root}>
        {header}
        <LoadError message="We couldn’t load your reviews." onRetry={() => { setStatus('loading'); setAttempt((n) => n + 1); }} />
      </SafeAreaView>
    );
  }
  if (status === 'loading' || !summary) {
    return (
      <SafeAreaView style={styles.root}>
        {header}
        <SkeletonList label="Loading reviews" rows={3} />
      </SafeAreaView>
    );
  }

  const chip = (on: boolean, label: string, onPress: () => void, a11y?: string) => (
    <TouchableOpacity
      key={label}
      style={[styles.chip, on && styles.chipOn]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={a11y ?? label}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.root}>
      {header}
      <FlatList
        data={reviews}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={styles.list}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setAttempt((n) => n + 1); }} />}
        ListHeaderComponent={
          <View style={{ gap: Spacing.sm }}>
            <View style={styles.card}>
              <Text style={styles.summary}>
                {summary.rating !== null && summary.rating_count > 0 ? `${stars(summary.rating)}  ` : ''}
                {reviewSummary(summary.rating, summary.rating_count)}
              </Text>
              {breakdownRows(summary.rating_breakdown, summary.rating_count).map((row) => (
                <View key={row.stars} style={styles.barRow} accessibilityLabel={`${row.stars} stars: ${row.count}`}>
                  <Text style={styles.barLabel}>{row.stars}★</Text>
                  <View style={styles.barTrack}><View style={[styles.barFill, { width: `${row.percent}%` }]} /></View>
                  <Text style={styles.barCount}>{row.count}</Text>
                </View>
              ))}
              <Text style={styles.muted}>{summary.with_comment_count} with a comment</Text>
            </View>
            <View style={styles.chips}>
              {[5, 4, 3, 2, 1].map((n) =>
                chip(filter.ratings.includes(n), `${n}★`, () => setFilter((f) => ({ ...f, ratings: toggleRating(f.ratings, n) })), `${n} stars`),
              )}
              {chip(filter.hasComment === true, 'With comment', () =>
                setFilter((f) => ({ ...f, hasComment: f.hasComment === true ? null : true })))}
            </View>
            <Text style={styles.muted}>{summary.total} review{summary.total === 1 ? '' : 's'} shown</Text>
          </View>
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ margin: Spacing.lg }} color={Colors.primary} /> : undefined}
        ListEmptyComponent={<Text style={[styles.muted, { textAlign: 'center', marginTop: Spacing.xl }]}>No reviews match these filters.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.rowTop}>
              <Text style={styles.stars} accessibilityLabel={`${item.rating} out of 5 stars`}>{stars(item.rating)}</Text>
              <Text style={styles.muted}>{formatDate(item.created_at)}{wasEdited(item) ? ' · edited' : ''}</Text>
            </View>
            {item.comment ? <Text style={styles.comment}>{item.comment}</Text> : null}
            <Text style={styles.muted}>
              {item.reviewer_name}{item.order_id ? ` · order #${item.order_id}` : ''}
            </Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

export default function MerchantReviewsScreen() {
  return (
    <ProtectedScreen>
      <Content />
    </ProtectedScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  list: { padding: Spacing.lg, gap: Spacing.sm },
  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.md, gap: 6,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.sm,
  },
  summary: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  barLabel: { width: 28, fontSize: FontSize.xs, color: Colors.textMuted },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: Colors.borderLight, overflow: 'hidden' },
  barFill: { height: 8, backgroundColor: Colors.warning },
  barCount: { width: 32, textAlign: 'right', fontSize: FontSize.xs, color: Colors.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md, minHeight: 36, justifyContent: 'center', borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '600' },
  chipTextOn: { color: Colors.white },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stars: { fontSize: FontSize.md, color: Colors.warning },
  comment: { fontSize: FontSize.sm, color: Colors.text, lineHeight: 20 },
  muted: { fontSize: FontSize.xs, color: Colors.textMuted },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl },
});
