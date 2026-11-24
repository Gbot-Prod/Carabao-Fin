// src/screens/ApplicationScreen.tsx
// S18 (plan §5.12): the merchant application status, route /application. The words are the
// web's (src/lib/application.ts): saved / submitted (the web success card), changes requested
// with the admin's notes and "Review and resubmit" (the web's label for the edit action),
// approved, suspended. "Go to Merchant Centre" re-runs the root gate (`retry`): the farm row
// exists from the first save, so the gate then lets the account into the tabs.
// src/screens/OnboardingScreen.tsx shows the same status first on /onboarding.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { api, WEB_BASE, type ApiMerchantApplication } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { useMerchantGate } from '../lib/MerchantContext';
import { Button } from '../components/UI';
import { APPLICATION_WORDS, applicationView, BUSINESS_STEP_PATH } from '../lib/application';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../lib/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const ICONS: Record<string, IoniconName> = {
  setup: 'document-text-outline',
  under_review: 'time-outline',
  needs_changes: 'alert-circle-outline',
  verified: 'checkmark-circle-outline',
  suspended: 'ban-outline',
};

/** The header row of both onboarding screens. */
export function OnboardingHeader({ title }: { title: string }) {
  const router = useRouter();
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={leave} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
        <Ionicons name="chevron-back" size={24} color={Colors.text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
    </View>
  );
}

/** The Plan 1 hand-off, kept as a fallback (S18 step 5). */
export function ContinueOnWeb() {
  return (
    <TouchableOpacity
      style={styles.webLink}
      onPress={() => void WebBrowser.openBrowserAsync(`${WEB_BASE}/merchantOnboarding`)}
      accessibilityRole="link"
    >
      <Text style={styles.webLinkText}>{APPLICATION_WORDS.continueOnWeb}</Text>
    </TouchableOpacity>
  );
}

type StatusProps = {
  application: ApiMerchantApplication;
  /** Opens the form at the business step; the default goes to /onboarding?step=business. */
  onEdit?: () => void;
};

/** One application's status card and its actions. */
export function ApplicationStatus({ application, onEdit }: StatusProps) {
  const router = useRouter();
  const { retry } = useMerchantGate();
  const view = applicationView(application);

  const goToCentre = () => {
    router.replace('/');
    retry();
  };
  const edit = onEdit ?? (() => router.push(BUSINESS_STEP_PATH));

  if (!view) {
    return (
      <View style={styles.card}>
        <Text style={styles.text}>{application.status}</Text>
        <ContinueOnWeb />
      </View>
    );
  }
  const action = view.step.action;
  // The business step is the edit; "Go to Shop" needs the tabs, so it goes through the gate.
  const editAction = action && action.path === BUSINESS_STEP_PATH ? action : null;

  return (
    <View style={styles.card}>
      <View style={styles.iconWrap}>
        <Ionicons name={ICONS[view.status] ?? 'document-text-outline'} size={40} color={Colors.primary} />
      </View>
      <Text style={styles.title}>{view.title}</Text>
      {application.merchant_name ? <Text style={styles.name}>{application.merchant_name}</Text> : null}
      {view.intro ? <Text style={styles.text}>{view.intro}</Text> : null}
      {view.status !== 'verified' ? <Text style={styles.notLive}>{APPLICATION_WORDS.notLive}</Text> : null}
      <Text style={styles.text}>{view.step.text}</Text>
      {view.note ? (
        <View style={styles.note}>
          <Text style={styles.noteText}>{APPLICATION_WORDS.notePrefix}{view.note}</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        {editAction ? <Button label={editAction.label} onPress={edit} fullWidth /> : null}
        {editAction ? (
          <TouchableOpacity style={styles.secondary} onPress={goToCentre} accessibilityRole="button">
            <Text style={styles.secondaryText}>{APPLICATION_WORDS.goToCentre}</Text>
          </TouchableOpacity>
        ) : (
          <Button label={APPLICATION_WORDS.goToCentre} onPress={goToCentre} fullWidth />
        )}
      </View>
    </View>
  );
}

/** Route /application: loads the account's application and shows its status. */
export default function ApplicationScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [application, setApplication] = useState<ApiMerchantApplication | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  // One load per attempt; "Try again" sets 'loading' and counts up.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    api.onboarding.myApplication(token)
      .then((app) => {
        if (!active) return;
        setApplication(app);
        setState('ready');
      })
      .catch(() => { if (active) setState('error'); });
    return () => { active = false; };
    // The token refreshes about every minute; a new token is no reason to load again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  const tryAgain = useCallback(() => {
    setState('loading');
    setAttempt((n) => n + 1);
  }, []);

  return (
    <SafeAreaView style={styles.screen}>
      <OnboardingHeader title="Application" />
      <ScrollView contentContainerStyle={styles.content}>
        {state === 'loading' ? (
          <ActivityIndicator size="large" color={Colors.primary} style={styles.spinner} />
        ) : state === 'error' ? (
          <View style={styles.card} accessibilityRole="alert">
            <Text style={styles.text}>{APPLICATION_WORDS.loadFailed}</Text>
            <View style={styles.actions}>
              <Button label={APPLICATION_WORDS.tryAgain} onPress={tryAgain} fullWidth />
            </View>
          </View>
        ) : application ? (
          <ApplicationStatus application={application} />
        ) : (
          // No application yet: the form is where to start.
          <View style={styles.card}>
            <Text style={styles.text}>Set up your farm to sell on Carabao.</Text>
            <View style={styles.actions}>
              <Button label="Apply to sell" onPress={() => router.replace('/onboarding')} fullWidth />
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.offWhite },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl * 2 },
  spinner: { marginTop: Spacing.xxl },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm, backgroundColor: Colors.white,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm, ...Shadow.sm },
  iconWrap: {
    width: 72, height: 72, borderRadius: 36, alignSelf: 'center', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primaryLight,
  },
  title: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  name: { fontSize: FontSize.md, fontWeight: '700', color: Colors.primaryDark, textAlign: 'center' },
  notLive: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text, marginTop: Spacing.sm },
  text: { fontSize: FontSize.sm, color: Colors.textMuted, lineHeight: 20 },
  note: { padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.borderLight },
  noteText: { fontSize: FontSize.sm, color: Colors.text, lineHeight: 20 },
  actions: { gap: Spacing.sm, marginTop: Spacing.md },
  secondary: {
    minHeight: 48, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.md, backgroundColor: Colors.borderLight,
  },
  secondaryText: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  webLink: { alignSelf: 'center', marginTop: Spacing.lg, minHeight: 44, justifyContent: 'center' },
  webLinkText: { fontSize: FontSize.sm, color: Colors.textMuted, textDecorationLine: 'underline' },
});
