import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { useAuth } from '../lib/AuthContext';
import { Colors, FontSize } from '../lib/theme';
import { useCart } from '../lib/CartContext';

import AuthScreen from '../screens/AuthScreen';
import OrderScreen from '../screens/OrderScreen';
import CartScreen from '../screens/CartScreen';
import TrackScreen from '../screens/TrackScreen';
import HistoryScreen from '../screens/HistoryScreen';
import ProfileScreen from '../screens/ProfileScreen';
import MerchantScreen from '../screens/MerchantScreen';
import CheckoutScreen from '../screens/CheckoutScreen';
import ConfirmationScreen from '../screens/ConfirmationScreen';
import OnboardingScreen from '../screens/OnboardingScreen';

import type { RootStackParamList, TabParamList } from '../types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const tabIcons: Record<string, { active: string; inactive: string }> = {
  Order: { active: '🛍️', inactive: '🛒' },
  Cart: { active: '🛒', inactive: '🛒' },
  Track: { active: '📍', inactive: '🗺️' },
  History: { active: '🕐', inactive: '📋' },
  Profile: { active: '👤', inactive: '👤' },
};

function TabIcon({ name, focused, cartCount }: { name: string; focused: boolean; cartCount?: number }) {
  const icon = focused ? tabIcons[name]?.active : tabIcons[name]?.inactive;
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
      <Text style={{ fontSize: 20 }}>{icon ?? '●'}</Text>
      {name === 'Cart' && cartCount && cartCount > 0 ? (
        <View style={{
          position: 'absolute', top: -4, right: -8,
          backgroundColor: Colors.error, width: 16, height: 16,
          borderRadius: 8, alignItems: 'center', justifyContent: 'center',
          borderWidth: 1.5, borderColor: Colors.white,
        }}>
          <Text style={{ color: Colors.white, fontSize: 9, fontWeight: '800' }}>
            {cartCount > 9 ? '9+' : cartCount}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function MainTabs() {
  const { itemCount } = useCart();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textLight,
        tabBarLabelStyle: styles.tabLabel,
        tabBarIcon: ({ focused }) => (
          <TabIcon
            name={route.name}
            focused={focused}
            cartCount={route.name === 'Cart' ? itemCount : undefined}
          />
        ),
      })}
    >
      <Tab.Screen name="Order" component={OrderScreen} options={{ title: 'Order' }} />
      <Tab.Screen name="Cart" component={CartScreen} options={{ title: 'Cart' }} />
      <Tab.Screen name="Track" component={TrackScreen} options={{ title: 'Track' }} />
      <Tab.Screen name="History" component={HistoryScreen} options={{ title: 'History' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
    </Tab.Navigator>
  );
}

function AuthenticatedStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MainTabs" component={MainTabs} />
      <Stack.Screen name="Merchant" component={MerchantScreen} />
      <Stack.Screen name="Checkout" component={CheckoutScreen} />
      <Stack.Screen name="Confirmation" component={ConfirmationScreen} />
      <Stack.Screen name="Onboarding" component={OnboardingScreen} />
    </Stack.Navigator>
  );
}

export default function AppNavigator() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.splash}>
        <View style={styles.splashLogo}>
          <Text style={{ fontSize: 32 }}>🌿</Text>
        </View>
        <Text style={styles.splashTitle}>Carabao</Text>
        <Text style={styles.splashSub}>Farm-fresh, delivered.</Text>
      </View>
    );
  }

  return (
    <NavigationContainer>
      {isAuthenticated ? (
        <AuthenticatedStack />
      ) : (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Auth" component={AuthScreen} />
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    height: Platform.OS === 'ios' ? 84 : 64,
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
    paddingTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 12,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  splash: {
    flex: 1,
    backgroundColor: Colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  splashLogo: {
    width: 72, height: 72, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  splashTitle: {
    fontSize: 36, fontWeight: '800', color: Colors.white, letterSpacing: -1,
  },
  splashSub: {
    fontSize: 15, color: 'rgba(255,255,255,0.7)',
  },
});
