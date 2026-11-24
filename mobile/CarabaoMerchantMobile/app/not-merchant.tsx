// app/not-merchant.tsx
// Where the gate sends a signed-in account that has no farm (plan §4.3). S19: the title, text
// and action are the web's MerchantWelcome.tsx, picked by the account's merchant application
// (src/lib/dashboard.ts merchantWelcome); the action opens /onboarding, or the help pages for a
// suspended account. The gate checks once per account, so "Check again" asks the server again
// after the farm is approved (no restart or sign-out needed).
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '../src/lib/AuthContext';
import { useMerchantGate } from '../src/lib/MerchantContext';
import { api, WEB_BASE } from '../src/lib/api';
import { merchantWelcome } from '../src/lib/dashboard';
import { webPageUrl } from '../src/lib/webPages';
import { Colors, FontSize, Radius, Spacing } from '../src/lib/theme';

export default function NotMerchantScreen() {
  const router = useRouter();
  const { signOut, token } = useAuth();
  // retry shows the gate's spinner, then the tabs if the account has a farm now.
  const { retry } = useMerchantGate();
  const [signingOut, setSigningOut] = useState(false);
  // undefined while loading. Not known (a failed call) reads as "no application", as the web:
  // the backend refuses a second application, so a wrong "Start Registration" does no harm.
  const [applicationStatus, setApplicationStatus] = useState<string | null | undefined>(undefined);
  const tokenRef = useRef(token);
  useEffect(() => { tokenRef.current = token; }, [token]);

  useEffect(() => {
    let active = true;
    api.onboarding.myApplication(tokenRef.current)
      .then((app) => { if (active) setApplicationStatus(app ? app.status : null); })
      .catch(() => { if (active) setApplicationStatus(null); });
    return () => { active = false; };
  }, []);

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  if (applicationStatus === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  const view = merchantWelcome(applicationStatus);
  const onAction = () => {
    if (view.action?.to === 'support') void WebBrowser.openBrowserAsync(webPageUrl(WEB_BASE, 'help'));
    else router.push('/onboarding');
  };

  return (
    <View style={styles.center}>
      <Text style={styles.title} accessibilityRole="header">{view.title}</Text>
      <Text style={styles.sub}>{view.body}</Text>
      {view.action && (
        <TouchableOpacity style={styles.btn} onPress={onAction} accessibilityRole="button">
          <Text style={styles.btnText}>{view.action.label}</Text>
        </TouchableOpacity>
      )}
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
