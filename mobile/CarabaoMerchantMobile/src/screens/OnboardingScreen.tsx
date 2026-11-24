// src/screens/OnboardingScreen.tsx
// S18 (plan §5.12): route /onboarding, the native application (it replaces the Plan 1 hand-off
// to the web form; a "Continue on the web" link stays as a fallback). An account with an
// application sees its status first (src/screens/ApplicationScreen.tsx); the edit action, or a
// link with `?step=business` (as on the web), opens the form at the business step. An account
// with no application, or one whose check failed, gets the form. After a save or a submit the
// status shows, with the web's success words.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api, type ApiMerchantApplication } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { showStatusFirst } from '../lib/application';
import { FORM_TITLE, initialStepIndex } from '../lib/onboarding';
import { Colors, Spacing } from '../lib/theme';
import OnboardingFormScreen from './OnboardingFormScreen';
import { ApplicationStatus, ContinueOnWeb, OnboardingHeader } from './ApplicationScreen';

export default function OnboardingScreen() {
  const { token } = useAuth();
  const { step } = useLocalSearchParams<{ step?: string }>();
  const [application, setApplication] = useState<ApiMerchantApplication | null>(null);
  const [mode, setMode] = useState<'loading' | 'status' | 'form'>('loading');
  const [formStep, setFormStep] = useState(() => initialStepIndex(step));

  useEffect(() => {
    let active = true;
    api.onboarding.myApplication(token)
      .then((app) => {
        if (!active) return;
        setApplication(app);
        setMode(showStatusFirst(app, step) ? 'status' : 'form');
      })
      // The form is the way on; its own prefill tries again.
      .catch(() => { if (active) setMode('form'); });
    return () => { active = false; };
    // Once per visit: the token refreshes about every minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (mode === 'form') {
    return (
      <OnboardingFormScreen
        initialStep={formStep}
        onSubmitted={(app) => {
          setApplication(app);
          setMode('status');
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <OnboardingHeader title={FORM_TITLE} />
      <ScrollView contentContainerStyle={styles.content}>
        {mode === 'loading' || !application ? (
          <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
        ) : (
          <>
            <ApplicationStatus
              application={application}
              onEdit={() => {
                setFormStep(initialStepIndex('business'));
                setMode('form');
              }}
            />
            <ContinueOnWeb />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.offWhite },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl * 2 },
  center: { marginTop: Spacing.xxl, alignItems: 'center' },
});
