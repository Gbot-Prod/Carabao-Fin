// app/_layout.tsx
// Carabao Merchant shell. Sign-in is wired in S3 (AuthProvider + /auth); the role gate
// (plan §4.3) and the tab bar (plan §4.2) arrive in later sections, so the app still
// boots on a placeholder route.
import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../src/lib/AuthContext';

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="auth" options={{ headerShown: false }} />
      </Stack>
    </AuthProvider>
  );
}
