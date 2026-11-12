// src/components/Skeleton.tsx
// Q1d: loading placeholders shaped like the list that is loading, and a load
// error with a retry so an outage isn't shown as "nothing here".
import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, AccessibilityInfo } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, FontSize } from '../lib/theme';

export function SkeletonList({
  label, rows = 3, grid = false,
}: { label: string; rows?: number; grid?: boolean }) {
  const pulse = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce || cancelled) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
        ]),
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [pulse]);

  return (
    <View
      style={[s.list, grid && s.grid]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
    >
      {Array.from({ length: rows }, (_, i) => (
        <Animated.View key={i} style={[grid ? s.card : s.row, { opacity: pulse }]}>
          {grid && <View style={[s.block, s.image]} />}
          <View style={s.lines}>
            <View style={[s.block, s.line]} />
            <View style={[s.block, s.line, { width: '55%' }]} />
            {!grid && <View style={[s.block, s.line, { width: '30%' }]} />}
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={s.error} accessibilityRole="alert">
      <Ionicons name="cloud-offline-outline" size={40} color={Colors.textLight} />
      <Text style={s.errorTitle}>Couldn't load</Text>
      <Text style={s.errorText}>{message}</Text>
      <TouchableOpacity style={s.retry} onPress={onRetry} accessibilityRole="button">
        <Text style={s.retryText}>Try again</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  list: { padding: Spacing.lg, gap: Spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  row: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg,
    borderWidth: 1, borderColor: Colors.border,
  },
  card: {
    width: '48%', backgroundColor: Colors.white, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', marginBottom: Spacing.sm,
  },
  image: { height: 90, borderRadius: 0 },
  lines: { gap: Spacing.sm, padding: Spacing.sm },
  block: { backgroundColor: Colors.borderLight, borderRadius: Radius.sm },
  line: { height: 12, width: '80%' },
  error: { alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl, gap: Spacing.sm },
  errorTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  errorText: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },
  retry: {
    marginTop: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm,
  },
  retryText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.sm },
});
