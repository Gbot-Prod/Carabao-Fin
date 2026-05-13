// src/components/CustomTabBar.tsx
import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Platform } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { Colors, FontSize, Shadow } from '../lib/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TAB_CONFIG: Record<string, { icon: IoniconName; iconActive: IoniconName; label: string }> = {
  order:   { icon: 'storefront-outline',  iconActive: 'storefront',   label: 'Shop'    },
  cart:    { icon: 'cart-outline',         iconActive: 'cart',          label: 'Cart'    },
  track:   { icon: 'location-outline',     iconActive: 'location',      label: 'Track'   },
  history: { icon: 'time-outline',         iconActive: 'time',          label: 'History' },
  profile: { icon: 'person-outline',       iconActive: 'person',        label: 'Profile' },
};

export default function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  const visibleRoutes = state.routes.filter((r) => r.name in TAB_CONFIG);

  return (
    <View style={[styles.wrapper, { paddingBottom: insets.bottom || 12 }]}>
      <View style={styles.bar}>
        {visibleRoutes.map((route) => {
          const isActive = state.index === state.routes.indexOf(route);
          const cfg = TAB_CONFIG[route.name] ?? {
            icon: 'ellipse-outline' as IoniconName,
            iconActive: 'ellipse' as IoniconName,
            label: route.name,
          };

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!isActive && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <TouchableOpacity
              key={route.key}
              onPress={onPress}
              activeOpacity={0.7}
              style={styles.tab}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={cfg.label}
            >
              {isActive && <View style={styles.activePill} />}
              <Ionicons
                name={isActive ? cfg.iconActive : cfg.icon}
                size={22}
                color={isActive ? Colors.primary : Colors.textLight}
              />
              <Text style={[styles.label, isActive && styles.labelActive]}>
                {cfg.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: 'transparent',
  },
  bar: {
    flexDirection: 'row',
    backgroundColor: Colors.white,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 8,
    paddingHorizontal: 4,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
      },
      android: { elevation: 10 },
      default: {},
    }),
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 3,
    position: 'relative',
  },
  activePill: {
    position: 'absolute',
    top: -2,
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.primary,
  },
  label: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    fontWeight: '500',
  },
  labelActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
});
