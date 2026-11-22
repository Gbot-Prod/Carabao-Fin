// app/_layout.tsx
// Carabao Merchant shell. The role gate (plan §4.3) and the tab bar (plan §4.2) are added in
// later sections; for now the app only boots on a placeholder route.
import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
