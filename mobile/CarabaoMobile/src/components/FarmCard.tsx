import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { deliveryFeeLabel, deliveryTimeLabel, ratingLabel, type Farm } from '../lib/farms';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';

interface FarmCardProps {
  farm: Farm;
  onPress: () => void;
}

export default function FarmCard({ farm, onPress }: FarmCardProps) {
  const time = deliveryTimeLabel(farm.deliveryDays);
  const fee = deliveryFeeLabel(farm.deliveryFee);
  const rating = ratingLabel(farm.rating);
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`${farm.name}, ${farm.location || 'farm'}, rating ${rating}`}
    >
      {farm.image ? (
        <Image source={{ uri: farm.image }} style={styles.image} contentFit="cover" />
      ) : (
        // CF-0111: no hot-linked stock photo for farms without a banner.
        <View style={[styles.image, styles.placeholder]}>
          <Ionicons name="leaf-outline" size={32} color={Colors.primary} />
        </View>
      )}
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{farm.category}</Text>
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{farm.name}</Text>
        {farm.location ? (
          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={11} color={Colors.textMuted} />
            <Text style={styles.location} numberOfLines={1}> {farm.location}</Text>
          </View>
        ) : null}
        <View style={styles.meta}>
          <Ionicons name={rating === 'New' ? 'sparkles-outline' : 'star'} size={11} color={Colors.warning} />
          <Text style={styles.rating}> {rating}</Text>
          {time ? (
            <>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.time}>{time}</Text>
            </>
          ) : null}
        </View>
        {fee ? <Text style={styles.fee}>{fee}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
    ...Shadow.sm,
  },
  image: { width: '100%', height: 110 },
  placeholder: { backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute', top: Spacing.sm, left: Spacing.sm,
    backgroundColor: Colors.primary, paddingHorizontal: 8,
    paddingVertical: 3, borderRadius: Radius.full,
  },
  badgeText: { color: Colors.white, fontSize: FontSize.xs, fontWeight: '700' },
  info: { padding: Spacing.sm, gap: 3 },
  name: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  locationRow: { flexDirection: 'row', alignItems: 'center' },
  location: { fontSize: FontSize.xs, color: Colors.textMuted },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rating: { fontSize: FontSize.xs, color: Colors.text, fontWeight: '600' },
  dot: { fontSize: FontSize.xs, color: Colors.textLight },
  time: { fontSize: FontSize.xs, color: Colors.textMuted },
  fee: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600' },
});
