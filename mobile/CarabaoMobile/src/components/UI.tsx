import React from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator,
  StyleSheet, ViewStyle, TextStyle,
} from 'react-native';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';

// ── StatRow ───────────────────────────────────────────────────────────────────
interface StatRowProps {
  label: string;
  value: string;
  bold?: boolean;
  style?: ViewStyle;
}

export function StatRow({ label, value, bold, style }: StatRowProps) {
  return (
    <View style={[sr.row, style]}>
      <Text style={[sr.label, bold && sr.bold]}>{label}</Text>
      <Text style={[sr.value, bold && sr.bold]}>{value}</Text>
    </View>
  );
}

const sr = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  label: { fontSize: FontSize.sm, color: Colors.textMuted },
  value: { fontSize: FontSize.sm, color: Colors.text },
  bold: { fontWeight: '700', color: Colors.text, fontSize: FontSize.md },
});

// ── Divider ───────────────────────────────────────────────────────────────────
export function Divider({ style }: { style?: ViewStyle }) {
  return <View style={[div.line, style]} />;
}

const div = StyleSheet.create({
  line: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.sm },
});

// ── Button ────────────────────────────────────────────────────────────────────
interface ButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
  disabled?: boolean;
}

export function Button({ label, onPress, loading, fullWidth, style, disabled }: ButtonProps) {
  return (
    <TouchableOpacity
      style={[btn.base, fullWidth && btn.full, (disabled || loading) && btn.disabled, style]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
    >
      {loading ? (
        <ActivityIndicator color={Colors.white} />
      ) : (
        <Text style={btn.label}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const btn = StyleSheet.create({
  base: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: 14, paddingHorizontal: Spacing.xl,
    alignItems: 'center', justifyContent: 'center',
    ...Shadow.sm,
  },
  full: { width: '100%' },
  disabled: { opacity: 0.6 },
  label: { color: Colors.white, fontSize: FontSize.md, fontWeight: '700' },
});

// ── EmptyState ────────────────────────────────────────────────────────────────
interface EmptyStateProps {
  icon: string;
  title: string;
  message: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  return (
    <View style={es.wrap}>
      <Text style={es.icon}>{icon}</Text>
      <Text style={es.title}>{title}</Text>
      <Text style={es.message}>{message}</Text>
      {action}
    </View>
  );
}

const es = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl, gap: Spacing.sm },
  icon: { fontSize: 52 },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  message: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },
});

// ── Badge ─────────────────────────────────────────────────────────────────────
type BadgeColor = 'green' | 'blue' | 'yellow' | 'gray';

const BADGE_COLORS: Record<BadgeColor, { bg: string; text: string }> = {
  green: { bg: Colors.successBg, text: Colors.success },
  blue: { bg: '#eff6ff', text: '#3b82f6' },
  yellow: { bg: Colors.warningBg, text: Colors.warning },
  gray: { bg: Colors.borderLight, text: Colors.textMuted },
};

interface BadgeProps {
  label: string;
  color: BadgeColor;
}

export function Badge({ label, color }: BadgeProps) {
  const c = BADGE_COLORS[color];
  return (
    <View style={[badge.wrap, { backgroundColor: c.bg }]}>
      <Text style={[badge.label, { color: c.text }]}>{label}</Text>
    </View>
  );
}

const badge = StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: Radius.full, alignSelf: 'flex-start' },
  label: { fontSize: FontSize.xs, fontWeight: '700' },
});

// ── Card ──────────────────────────────────────────────────────────────────────
interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

export function Card({ children, style }: CardProps) {
  return (
    <View style={[card.wrap, style]}>
      {children}
    </View>
  );
}

const card = StyleSheet.create({
  wrap: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, borderWidth: 1, borderColor: Colors.border,
    ...Shadow.sm,
  },
});
