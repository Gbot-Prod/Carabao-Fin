// src/screens/ConfirmationScreen.tsx
import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView,
  TouchableOpacity, Animated, ScrollView,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { RootStackParamList } from '../types';

type ConfRoute = RouteProp<RootStackParamList, 'Confirmation'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

const STEPS = [
  { icon: '✅', label: 'Merchant confirms stock' },
  { icon: '📦', label: 'Produce is prepared and packed' },
  { icon: '🚚', label: 'Rider pickup and delivery' },
];

export default function ConfirmationScreen() {
  const route = useRoute<ConfRoute>();
  const navigation = useNavigation<Nav>();
  const { orderId } = route.params;

  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const slideY = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 80, friction: 6 }),
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(slideY, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Check animation */}
        <View style={styles.heroArea}>
          <Animated.View style={[styles.checkCircle, { transform: [{ scale }] }]}>
            <Text style={styles.checkEmoji}>✓</Text>
          </Animated.View>
          <Animated.View style={{ opacity, transform: [{ translateY: slideY }] }}>
            <Text style={styles.heroTitle}>Order Confirmed!</Text>
            <Text style={styles.heroSub}>
              Your request has been sent to the farm and is queued for processing.
            </Text>
          </Animated.View>
        </View>

        <Animated.View style={[styles.content, { opacity, transform: [{ translateY: slideY }] }]}>
          {/* Order Details */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Order Details</Text>
            <View style={styles.detailsGrid}>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Order Reference</Text>
                <Text style={styles.detailValue}>{orderId}</Text>
              </View>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Estimated Delivery</Text>
                <Text style={styles.detailValue}>1–2 business days</Text>
              </View>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Payment Status</Text>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusText}>Pending Confirmation</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Timeline */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>What happens next?</Text>
            {STEPS.map((step, i) => (
              <View key={step.label} style={styles.timelineStep}>
                <View style={styles.timelineLeft}>
                  <View style={styles.stepNumBadge}>
                    <Text style={styles.stepNum}>{i + 1}</Text>
                  </View>
                  {i < STEPS.length - 1 && <View style={styles.stepLine} />}
                </View>
                <View style={styles.stepContent}>
                  <Text style={styles.stepIcon}>{step.icon}</Text>
                  <Text style={styles.stepLabel}>{step.label}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => (navigation as any).navigate('MainTabs', { screen: 'Track' })}
            >
              <Text style={styles.primaryBtnText}>📍  Track Order</Text>
            </TouchableOpacity>

            <View style={styles.secondaryRow}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => (navigation as any).navigate('MainTabs', { screen: 'History' })}
              >
                <Text style={styles.secondaryBtnText}>View History</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => (navigation as any).navigate('MainTabs', { screen: 'Order' })}
              >
                <Text style={styles.secondaryBtnText}>Place Another</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  scroll: { paddingBottom: 40 },

  heroArea: {
    backgroundColor: Colors.primaryDark,
    paddingTop: 50, paddingBottom: 60,
    paddingHorizontal: Spacing.xxl,
    alignItems: 'center', gap: Spacing.xl,
    overflow: 'hidden',
  },
  checkCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: Colors.white,
    alignItems: 'center', justifyContent: 'center',
    ...Shadow.lg,
  },
  checkEmoji: { fontSize: 44, color: Colors.primary },
  heroTitle: {
    fontSize: FontSize.xxxl, fontWeight: '800', color: Colors.white,
    textAlign: 'center', letterSpacing: -0.5,
  },
  heroSub: {
    fontSize: FontSize.sm, color: 'rgba(255,255,255,0.8)',
    textAlign: 'center', lineHeight: 20, maxWidth: 280,
  },

  content: {
    marginTop: -24, paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xxl, gap: Spacing.md,
  },

  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, borderWidth: 1, borderColor: Colors.border, ...Shadow.sm,
  },
  cardTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, marginBottom: Spacing.md },

  detailsGrid: { gap: Spacing.sm },
  detailItem: {
    backgroundColor: Colors.surfaceAlt, borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  detailLabel: { fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: '600', marginBottom: 4 },
  detailValue: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  statusBadge: {
    alignSelf: 'flex-start', backgroundColor: Colors.warningBg,
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: Radius.full,
  },
  statusText: { fontSize: FontSize.xs, color: Colors.warning, fontWeight: '700' },

  timelineStep: { flexDirection: 'row', gap: Spacing.md, marginBottom: 4 },
  timelineLeft: { alignItems: 'center', width: 28 },
  stepNumBadge: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  stepNum: { fontSize: FontSize.sm, fontWeight: '800', color: Colors.primary },
  stepLine: { width: 2, flex: 1, backgroundColor: Colors.border, marginTop: 4, marginBottom: 4 },
  stepContent: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    gap: Spacing.sm, paddingBottom: Spacing.md,
  },
  stepIcon: { fontSize: 18 },
  stepLabel: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '500', flex: 1 },

  actions: { gap: Spacing.sm, marginTop: Spacing.sm },
  primaryBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: 15, alignItems: 'center', ...Shadow.sm,
  },
  primaryBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '700' },
  secondaryRow: { flexDirection: 'row', gap: Spacing.sm },
  secondaryBtn: {
    flex: 1, backgroundColor: Colors.white, borderRadius: Radius.md,
    paddingVertical: 13, alignItems: 'center',
    borderWidth: 1.5, borderColor: Colors.border,
  },
  secondaryBtnText: { color: Colors.text, fontSize: FontSize.sm, fontWeight: '600' },
});
