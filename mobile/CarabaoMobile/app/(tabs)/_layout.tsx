import { Tabs } from 'expo-router';
import React from 'react';
import CustomTabBar from '../../src/components/CustomTabBar';

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen name="App" options={{ href: null }} />
      <Tabs.Screen name="order" />
      <Tabs.Screen name="cart" />
      <Tabs.Screen name="track" />
      <Tabs.Screen name="history" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
