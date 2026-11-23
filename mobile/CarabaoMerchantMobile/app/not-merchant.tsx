// app/not-merchant.tsx
// Where the gate sends a signed-in account that has no farm (plan §4.3). "Apply to
// sell" opens /onboarding; the words match the old buyer ProtectedScreen, which
// this gate replaces. The gate checks once per account, so "Check again" asks the
// server again after the farm is approved on the web (no restart or sign-out needed).
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/lib/AuthContext';
import { useMerchantGate } from '../src/lib/MerchantContext';
import { Colors, FontSize, Radius, Spacing } from '../src/lib/theme';

export default function NotMerchantScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  // retry shows the gate's spinner, then the tabs if the account has a farm now.
  const { retry } = useMerchantGate();
  const [signingOut, setSigningOut] = useState(false);

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <View style={styles.center}>
      <Text style={styles.title}>This app is for farm accounts</Text>
      <Text style={styles.sub}>Set up your farm to sell on Carabao.</Text>
      <TouchableOpacity
        style={styles.btn}
        onPress={() => router.push('/onboarding')}
        accessibilityRole="button"
      >
        <Text style={styles.btnText}>Apply to sell</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.link} onPress={retry} accessibilityRole="button">
        <Text style={styles.linkText}>Already approved? Check again</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.link}
        onPress={onSignOut}
        disabled={signingOut}
        accessibilityRole="button"
      >
        {signingOut
          ? <ActivityIndicator color={Colors.textMuted} />
          : <Text style={styles.linkText}>Sign out</Text>}
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
  link: { marginTop: Spacing.sm, minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.lg },
  linkText: { color: Colors.textMuted, fontWeight: '700', fontSize: FontSize.sm },
});
