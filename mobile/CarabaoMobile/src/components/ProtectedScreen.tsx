import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { Colors, Spacing } from '../lib/theme';

// CF-0120: this is a sign-in wrapper only. Role checks live in the merchant app
// (its root gate asks the server for /users/me `merchant`).

interface ProtectedScreenProps {
  children: React.ReactNode;
}

/**
 * Wrapper that enforces sign-in (CF-0120). Signed out → the sign-in screen.
 * Whoever is signed in sees the screen; the server still checks every call.
 */
export function ProtectedScreen({ children }: ProtectedScreenProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/auth');
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  }
  if (!isAuthenticated) return null;
  return <>{children}</>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl, gap: Spacing.sm, backgroundColor: Colors.offWhite },
});
