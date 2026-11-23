// app/_layout.tsx
// Carabao Merchant shell: providers, then the root gate (plan §4.3). The gate asks
// the server once per account (/users/me `merchant`); until it says `allowed`, no
// merchant screen is mounted, so none of them can call /merchants/me/*.
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider } from '../src/lib/AuthContext';
import { MerchantDataProvider } from '../src/lib/MerchantDataContext';
import { MerchantProvider, useMerchantGate } from '../src/lib/MerchantContext';
import { Colors, FontSize, Radius, Spacing } from '../src/lib/theme';

// Deep links (carabaomerchant://orders, ...) mount the tab shell underneath, so back
// returns to the tabs instead of leaving the app (same setting as the buyer app).
export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <AuthProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <MerchantProvider>
              <StatusBar style="auto" />
              <RootGate />
            </MerchantProvider>
          </ThemeProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Signed out → `/auth`, no farm → `/not-merchant`, farm → the app. `Stack.Protected`
 * keeps every other screen from mounting (they render a redirect instead), and the
 * navigator itself stays unmounted while the check runs.
 */
function RootGate() {
  const { status, retry } = useMerchantGate();

  if (status === 'wait') {
    return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  }
  if (status === 'error') {
    return (
      <View style={styles.center} accessibilityRole="alert">
        <Text style={styles.title}>Could not check your account</Text>
        <Text style={styles.sub}>Check your connection and try again.</Text>
        <TouchableOpacity style={styles.btn} onPress={retry} accessibilityRole="button">
          <Text style={styles.btnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const navigator = (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected
        guard={status === 'allowed'}
        redirectTo={status === 'signin' ? '/auth' : '/not-merchant'}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="reviews" options={{ headerShown: false }} />
        <Stack.Screen name="notifications" options={{ headerShown: false }} />
        <Stack.Screen name="order-chat" options={{ headerShown: false }} />
        {/* Decision D2: placeholders until S14/S15/S16/S18 (S10's earnings, S11's shipments and
            S12's route are built). */}
        <Stack.Screen name="shipments" options={{ headerShown: false }} />
        <Stack.Screen name="route" options={{ headerShown: false }} />
        <Stack.Screen name="earnings" options={{ headerShown: false }} />
        <Stack.Screen name="inventory" options={{ headerShown: false }} />
        <Stack.Screen name="shop" options={{ headerShown: false }} />
        <Stack.Screen name="vouchers" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="application" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected
        guard={status === 'signin'}
        redirectTo={status === 'forbidden' ? '/not-merchant' : '/'}
      >
        <Stack.Screen name="auth" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected
        guard={status === 'forbidden'}
        redirectTo={status === 'signin' ? '/auth' : '/'}
      >
        <Stack.Screen name="not-merchant" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );

  // S3: the shared data (and its /merchants/me/* calls) exists only for a farm account,
  // so the provider mounts inside the gate; signing out unmounts it with its data.
  return status === 'allowed' ? (
    <MerchantDataProvider>{navigator}</MerchantDataProvider>
  ) : (
    navigator
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl, gap: Spacing.sm, backgroundColor: Colors.offWhite },
  title: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  sub: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' },
  btn: { marginTop: Spacing.md, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: Spacing.xl, minHeight: 44, justifyContent: 'center' },
  btnText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.sm },
});
