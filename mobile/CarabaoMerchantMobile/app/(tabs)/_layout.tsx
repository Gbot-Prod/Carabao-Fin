// app/(tabs)/_layout.tsx
// The merchant shell's five tabs (plan §4.2). Decision D1: the stock `Tabs` bar with
// Ionicons and no new dependency - the buyer app's `CustomTabBar` is buyer-only (its
// middle tab is the cart). Screens own their headers, so the bar hides them. Each icon
// is filled when its tab is active and outlined otherwise.
//
// S3: the badges are the web MerchantShell.tsx counts (src/lib/badges.ts): Orders =
// active orders, Chats = chats with unread messages (alert colour), Produce = listings.
// S5: the Chats count is order chats plus questions (the web's Chats page total).
import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMerchantData } from '../../src/lib/MerchantDataContext';
import { activeOrderCount, productCount, unreadChatCount } from '../../src/lib/badges';
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

/** The tab bar draws nothing for 0; a badge means "look at this tab". */
function badge(count: number): number | undefined {
  return count > 0 ? count : undefined;
}

export default function TabsLayout() {
  // null until the shared load finishes (MerchantDataContext.tsx): no badge, no 0.
  const { orders, chats, inquiries, produce } = useMerchantData();
  const activeOrders = orders ? activeOrderCount(orders) : 0;
  const unreadChats = unreadChatCount(chats ?? [], inquiries ?? []);
  const products = produce ? productCount(produce) : 0;

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
          tabBarBadge: badge(activeOrders),
          tabBarIcon: (props) => <TabBarIcon {...props} active="receipt" inactive="receipt-outline" />,
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarBadge: badge(unreadChats),
          // The web's alert tone for the chats count (MerchantShell.tsx countTone="alert").
          tabBarBadgeStyle: { backgroundColor: Colors.error },
          tabBarIcon: (props) => <TabBarIcon {...props} active="chatbubbles" inactive="chatbubbles-outline" />,
        }}
      />
      <Tabs.Screen
        name="produce"
        options={{
          title: 'Produce',
          tabBarBadge: badge(products),
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


