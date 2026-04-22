import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Farm } from '../lib/mockData';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';

interface FarmCardProps {
  farm: Farm;
  onPress: () => void;
}

export default function FarmCard({ farm, onPress }: FarmCardProps) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <Image source={{ uri: farm.image }} style={styles.image} resizeMode="cover" />
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{farm.category}</Text>
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{farm.name}</Text>
        <Text style={styles.location} numberOfLines={1}>📍 {farm.location}</Text>
        <View style={styles.meta}>
          <Text style={styles.rating}>⭐ {farm.rating}</Text>
          <Text style={styles.dot}>·</Text>
          <Text style={styles.time}>{farm.time}</Text>
        </View>
        <Text style={styles.fee}>₱{farm.deliveryFee} delivery</Text>
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
  badge: {
    position: 'absolute', top: Spacing.sm, left: Spacing.sm,
    backgroundColor: Colors.primary, paddingHorizontal: 8,
    paddingVertical: 3, borderRadius: Radius.full,
  },
  badgeText: { color: Colors.white, fontSize: FontSize.xs, fontWeight: '700' },
  info: { padding: Spacing.sm, gap: 3 },
  name: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  location: { fontSize: FontSize.xs, color: Colors.textMuted },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rating: { fontSize: FontSize.xs, color: Colors.text, fontWeight: '600' },
  dot: { fontSize: FontSize.xs, color: Colors.textLight },
  time: { fontSize: FontSize.xs, color: Colors.textMuted },
  fee: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600' },
});
