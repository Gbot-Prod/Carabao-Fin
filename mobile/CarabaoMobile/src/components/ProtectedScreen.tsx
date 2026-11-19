import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { api } from '../lib/api';
import { decideAccess, type MerchantCheck, type RequiredRole } from '../lib/access';
import { Colors, Spacing, FontSize, Radius } from '../lib/theme';

interface ProtectedScreenProps {
  children: React.ReactNode;
  requiredRole?: RequiredRole;
}

/**
 * Wrapper that enforces sign-in, and a role when one is given (CF-0120).
 * Signed out → the sign-in screen. `requiredRole="merchant"` asks the server
 * (/users/me) and mounts the screen only for a merchant, so a buyer never sends
 * merchant API calls; the server still checks every call. Admin screens do not
 * exist on mobile (ADMIN_WEB_ONLY).
 */
export function ProtectedScreen({ children, requiredRole }: ProtectedScreenProps) {
  const { isAuthenticated, isLoading, token, user } = useAuth();
  const router = useRouter();
  const needsMerchant = requiredRole === 'merchant' && isAuthenticated;
  // Keyed by user + attempt, so another account or a retry checks again.
  const key = needsMerchant ? `${user?.id ?? ''}` : '';
  const [check, setCheck] = useState<{ key: string; value: MerchantCheck }>({ key: '', value: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const merchant: MerchantCheck = check.key === `${key}|${attempt}` ? check.value : 'idle';

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/auth');
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (!needsMerchant) return;
    let active = true;
    const k = `${key}|${attempt}`;
    api.users
      .me(token)
      .then((p) => { if (active) setCheck({ key: k, value: { isMerchant: !!p.merchant } }); })
      .catch(() => { if (active) setCheck({ key: k, value: 'error' }); });
    return () => { active = false; };
  }, [needsMerchant, key, attempt, token]);

  const access = decideAccess({ isLoading, isAuthenticated }, requiredRole, merchant);
  if (access === 'allowed') return <>{children}</>;
  if (access === 'signin') return null;
  if (access === 'wait') {
    return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  }
  return (
    <View style={styles.center} accessibilityRole="alert">
      <Text style={styles.title}>{access === 'error' ? 'Could not check your account' : 'This page is for farm accounts'}</Text>
      <Text style={styles.sub}>
        {access === 'error'
          ? 'Check your connection and try again.'
          : requiredRole === 'admin'
            ? 'Admin tools are on the Carabao website.'
            : 'Set up your farm to sell on Carabao.'}
      </Text>
      <TouchableOpacity
        style={styles.btn}
        onPress={() => (access === 'error' ? setAttempt((n) => n + 1) : requiredRole === 'merchant' ? router.replace('/onboarding') : router.back())}
        accessibilityRole="button"
      >
        <Text style={styles.btnText}>{access === 'error' ? 'Try again' : requiredRole === 'merchant' ? 'Set up my farm' : 'Go back'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl, gap: Spacing.sm, backgroundColor: Colors.offWhite },
  title: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  sub: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' },
  btn: { marginTop: Spacing.md, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: Spacing.xl, minHeight: 44, justifyContent: 'center' },
  btnText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.sm },
});
