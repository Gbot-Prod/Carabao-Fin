import { Platform } from 'react-native';

export const Colors = {
  primary: '#22c55e',
  primaryDark: '#15803d',
  primaryLight: '#dcfce7',
  white: '#ffffff',
  offWhite: '#f9fafb',
  text: '#111827',
  textMuted: '#6b7280',
  textLight: '#9ca3af',
  border: '#e5e7eb',
  borderLight: '#f3f4f6',
  surfaceAlt: '#f9fafb',
  error: '#ef4444',
  errorBg: '#fef2f2',
  success: '#22c55e',
  successBg: '#f0fdf4',
  warning: '#f59e0b',
  warningBg: '#fffbeb',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
};

export const Radius = {
  sm: 6,
  md: 10,
  lg: 16,
  full: 999,
};

export const FontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  xxxl: 30,
  display: 36,
};

export const Shadow = {
  sm: Platform.select({
    ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
    android: { elevation: 2 },
    default: {},
  }) as object,
  md: Platform.select({
    ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8 },
    android: { elevation: 4 },
    default: {},
  }) as object,
  lg: Platform.select({
    ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 16 },
    android: { elevation: 8 },
    default: {},
  }) as object,
};
