// app/(tabs)/_layout.tsx
// The merchant shell's five tabs (plan §4.2). Decision D1: the stock `Tabs` bar with
// Ionicons and no new dependency - the buyer app's `CustomTabBar` is buyer-only (its
// middle tab is the cart). Screens own their headers, so the bar hides them. Each icon
// is filled when its tab is active and outlined otherwise.
import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, FontSize } from '../../src/lib/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * The tab bar hands `tabBarIcon` React Navigation's resolved tint, whose type also allows
 * numbers and null; Ionicons only takes a color string. Our tints are strings, so keep
 * those and fall back to the inactive color.
 */
function tint(color: unknown): string {
  return typeof color === 'string' ? color : Colors.textLight;
}

interface TabBarIconProps {
  focused: boolean;
  color: unknown;
  size: number;
  active: IoniconName;
  inactive: IoniconName;
}

function TabBarIcon({ focused, color, size, active, inactive }: TabBarIconProps) {
  return <Ionicons name={focused ? active : inactive} size={size} color={tint(color)} />;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textLight,
        tabBarStyle: { backgroundColor: Colors.white, borderTopColor: Colors.border },
        tabBarLabelStyle: { fontSize: FontSize.xs, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: (props) => <TabBarIcon {...props} active="home" inactive="home-outline" />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Orders',
          tabBarIcon: (props) => <TabBarIcon {...props} active="receipt" inactive="receipt-outline" />,
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarIcon: (props) => <TabBarIcon {...props} active="chatbubbles" inactive="chatbubbles-outline" />,
        }}
      />
      <Tabs.Screen
        name="produce"
        options={{
          title: 'Produce',
          tabBarIcon: (props) => <TabBarIcon {...props} active="leaf" inactive="leaf-outline" />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: (props) => (
            <TabBarIcon
              {...props}
              active="ellipsis-horizontal-circle"
              inactive="ellipsis-horizontal-circle-outline"
            />
          ),
        }}
      />
    </Tabs>
  );
}


