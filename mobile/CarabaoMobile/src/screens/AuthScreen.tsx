// src/screens/AuthScreen.tsx
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
  Dimensions, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { requirePhone, TwoFactorRequiredError, useAuth } from '../lib/AuthContext';
import { WEB_BASE } from '../lib/api';
import { formatPhMobile } from '../lib/phone';
import { PasswordResetSheet } from '../components/PasswordResetSheet';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';

const { width } = Dimensions.get('window');

const RESEND_COOLDOWN_MS = 60_000;

/**
 * Sign in with a mobile number (or a verified email) and password. Sign up with
 * a mobile number only: we text a code, and checking it creates the account.
 */
export default function AuthScreen() {
  const { signIn, sendPhoneCode, signUpWithPhone } = useAuth();
  // "Create account" from the cart prompt (E4) opens on sign-up.
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<'signin' | 'signup'>(params.mode === 'signup' ? 'signup' : 'signin');
  // Forgot password (E6).
  const [resetOpen, setResetOpen] = useState(false);
  const [notice, setNotice] = useState('');
  // E8d: accounts with two-step verification sign in on the website for now.
  const [needsWeb, setNeedsWeb] = useState(false);
  const [form, setForm] = useState({
    // Sign-in: a mobile number or an email the account has verified.
    identifier: '',
    phone: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Sign-up texts a 6-digit code to the number first.
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [lastSentAt, setLastSentAt] = useState(0);

  const switchMode = (next: 'signin' | 'signup') => {
    setMode(next);
    setError('');
    setNotice('');
    setCodeSent(false);
    setCode('');
  };

  const sendSignupCode = async () => {
    if (Date.now() - lastSentAt < RESEND_COOLDOWN_MS) {
      setError('Please wait a minute before asking for another code.');
      return;
    }
    await sendPhoneCode(form.phone);
    setLastSentAt(Date.now());
    setCodeSent(true);
    setNotice(`We texted a 6-digit code to ${formatPhMobile(requirePhone(form.phone))}.`);
  };

  const finishSignup = async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code from the text.');
      return;
    }
    const name = [form.firstName.trim(), form.lastName.trim()].filter(Boolean).join(' ');
    // Signed in either way; a number that already had an account keeps its
    // password. Like sign-in, the app moves on once the session is set.
    await signUpWithPhone({ phoneNumber: form.phone, code, name, password: form.password });
  };

  const handleChange = (key: string, val: string) =>
    setForm((p) => ({ ...p, [key]: val }));

  const handleSubmit = async () => {
    setError('');
    if (mode === 'signup' && !codeSent) {
      if (!form.phone.trim()) {
        setError('Enter your mobile number.');
        return;
      }
      setLoading(true);
      try {
        await sendSignupCode();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'We couldn\'t send the code.');
      } finally {
        setLoading(false);
      }
      return;
    }
    if ((mode === 'signin' && !form.identifier) || !form.password) {
      setError('Please fill in all required fields');
      return;
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (form.password.length > 128) {
      setError('Password must be 128 characters or fewer');
      return;
    }
    if (mode === 'signup' && form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    setNeedsWeb(false);
    try {
      if (mode === 'signin') {
        await signIn(form.identifier, form.password);
      } else {
        await finishSignup();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Authentication failed. Please try again.';
      setNeedsWeb(err instanceof TwoFactorRequiredError);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Hero Panel */}
        <View style={styles.heroBg}>
          <View style={styles.heroOrb1} />
          <View style={styles.heroOrb2} />
          <View style={styles.heroContent}>
            <View style={styles.logoWrap}>
              <Ionicons name="leaf" size={26} color={Colors.white} />
            </View>
            <Text style={styles.heroTitle}>Carabao</Text>
            <Text style={styles.heroSub}>
              Farm-fresh produce, delivered with confidence. Join the marketplace connecting buyers with trusted local farms.
            </Text>
          </View>
        </View>

        {/* Form Card */}
        <View style={styles.formCard}>
          {/* Mode Switcher */}
          <View style={styles.switcher}>
            <TouchableOpacity
              style={[styles.switchBtn, mode === 'signin' && styles.switchBtnActive]}
              onPress={() => switchMode('signin')}
            >
              <Text style={[styles.switchBtnText, mode === 'signin' && styles.switchBtnTextActive]}>
                Sign In
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.switchBtn, mode === 'signup' && styles.switchBtnActive]}
              onPress={() => switchMode('signup')}
            >
              <Text style={[styles.switchBtnText, mode === 'signup' && styles.switchBtnTextActive]}>
                Sign Up
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.formTitle}>
            {mode === 'signin' ? 'Welcome back' : 'Create account'}
          </Text>
          <Text style={styles.formSub}>
            {mode === 'signin'
              ? 'Sign in with your mobile number or email'
              : 'Sign up with your mobile number. You can add an email later in your profile.'}
          </Text>

          {/* Error */}
          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="warning-outline" size={15} color={Colors.error} style={{ marginRight: 6 }} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          {needsWeb ? (
            <TouchableOpacity
              style={styles.webBtn}
              onPress={() => void Linking.openURL(`${WEB_BASE}/auth`)}
              accessibilityRole="link"
            >
              <Text style={styles.webBtnText}>Open the Carabao website to sign in</Text>
            </TouchableOpacity>
          ) : null}

          {/* Fields */}
          {mode === 'signin' ? (
            <TextInput
              style={styles.input}
              placeholder="Mobile number or email"
              placeholderTextColor={Colors.textLight}
              value={form.identifier}
              onChangeText={(v) => handleChange('identifier', v)}
              autoCapitalize="none"
              autoComplete="username"
            />
          ) : (
            <TextInput
              style={styles.input}
              placeholder="Mobile number, e.g. 0912 345 6789"
              placeholderTextColor={Colors.textLight}
              value={form.phone}
              onChangeText={(v) => {
                handleChange('phone', v);
                // A code is for one number; a changed number needs a new one.
                if (codeSent) { setCodeSent(false); setCode(''); setNotice(''); }
              }}
              keyboardType="phone-pad"
              autoComplete="tel"
            />
          )}

          {mode === 'signup' && codeSent && (
            <>
              <TextInput
                style={styles.input}
                placeholder="6-digit code from the text"
                placeholderTextColor={Colors.textLight}
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={6}
                autoComplete="one-time-code"
              />
              <TouchableOpacity
                onPress={() => { setError(''); void sendSignupCode().catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not send the code.')); }}
                style={styles.forgotWrap}
                disabled={loading}
              >
                <Text style={styles.forgotText}>Send a new code</Text>
              </TouchableOpacity>
            </>
          )}

          {mode === 'signup' && codeSent && (
            <View style={styles.nameRow}>
              <TextInput
                style={[styles.input, styles.halfInput]}
                placeholder="First name"
                placeholderTextColor={Colors.textLight}
                value={form.firstName}
                onChangeText={(v) => handleChange('firstName', v)}
                autoComplete="given-name"
              />
              <TextInput
                style={[styles.input, styles.halfInput]}
                placeholder="Last name"
                placeholderTextColor={Colors.textLight}
                value={form.lastName}
                onChangeText={(v) => handleChange('lastName', v)}
                autoComplete="family-name"
              />
            </View>
          )}

          {(mode === 'signin' || codeSent) && (
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={Colors.textLight}
              value={form.password}
              onChangeText={(v) => handleChange('password', v)}
              secureTextEntry
              autoComplete={mode === 'signin' ? 'password' : 'password-new'}
              maxLength={128}
            />
          )}
          {mode === 'signup' && codeSent && (
            <TextInput
              style={styles.input}
              placeholder="Confirm password"
              placeholderTextColor={Colors.textLight}
              value={form.confirmPassword}
              onChangeText={(v) => handleChange('confirmPassword', v)}
              secureTextEntry
              maxLength={128}
            />
          )}

          {mode === 'signin' && (
            <TouchableOpacity onPress={() => { setNotice(''); setResetOpen(true); }} style={styles.forgotWrap}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>
          )}
          {notice ? <Text style={styles.noticeText}>{notice}</Text> : null}

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitBtn, loading && styles.submitDisabled]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={styles.submitText}>
                {mode === 'signin' ? 'Sign In' : codeSent ? 'Create Account' : 'Text Me a Code'}
              </Text>
            )}
          </TouchableOpacity>

          <Text style={styles.terms}>
            By continuing, you agree to our{' '}
            <Text style={styles.termsLink}>Terms of Service</Text>
            {' '}and{' '}
            <Text style={styles.termsLink}>Privacy Policy</Text>
          </Text>
        </View>
      </ScrollView>
      <PasswordResetSheet
        visible={resetOpen}
        initialIdentifier={form.identifier}
        onClose={() => setResetOpen(false)}
        onDone={({ identifier, byEmail }) => {
          setResetOpen(false);
          setError('');
          handleChange('identifier', identifier);
          handleChange('password', '');
          setNotice(
            byEmail
              ? 'Check your email for a reset link. Choose a new password there, then sign in here.'
              : 'Your password has been changed. Sign in with it now.',
          );
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  webBtn: {
    borderWidth: 1, borderColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: Spacing.sm, alignItems: 'center', marginBottom: Spacing.sm,
  },
  webBtnText: { color: Colors.primary, fontWeight: '700', fontSize: FontSize.sm },
  forgotWrap: { alignSelf: 'flex-end', paddingVertical: 4 },
  forgotText: { color: Colors.primary, fontWeight: '600', fontSize: FontSize.sm },
  noticeText: { color: Colors.success, fontSize: FontSize.sm, marginTop: 4 },
  scroll: { flexGrow: 1 },

  heroBg: {
    backgroundColor: Colors.primaryDark,
    paddingHorizontal: Spacing.xxl,
    paddingTop: 60,
    paddingBottom: 80,
    overflow: 'hidden',
    position: 'relative',
  },
  heroOrb1: {
    position: 'absolute', width: 200, height: 200, borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.07)', top: -40, right: -40,
  },
  heroOrb2: {
    position: 'absolute', width: 140, height: 140, borderRadius: 70,
    backgroundColor: 'rgba(255,255,255,0.05)', bottom: -20, left: 20,
  },
  heroContent: { position: 'relative', zIndex: 2 },
  logoWrap: {
    width: 52, height: 52, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md,
  },
  heroTitle: {
    fontSize: FontSize.display, fontWeight: '800', color: Colors.white,
    letterSpacing: -1, marginBottom: Spacing.sm,
  },
  heroSub: {
    fontSize: FontSize.sm, color: 'rgba(255,255,255,0.8)',
    lineHeight: 20, maxWidth: 280,
  },

  formCard: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: -28,
    flex: 1,
    paddingHorizontal: Spacing.xxl,
    paddingTop: Spacing.xxl,
    paddingBottom: 40,
    ...Shadow.lg,
  },

  switcher: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f1',
    borderRadius: Radius.full,
    padding: 4,
    marginBottom: Spacing.xl,
    alignSelf: 'flex-start',
  },
  switchBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 8,
    borderRadius: Radius.full,
  },
  switchBtnActive: { backgroundColor: Colors.primary },
  switchBtnText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textMuted },
  switchBtnTextActive: { color: Colors.white },

  formTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, marginBottom: 4 },
  formSub: { fontSize: FontSize.sm, color: Colors.textMuted, marginBottom: Spacing.xl },

  errorBox: {
    backgroundColor: Colors.errorBg,
    borderWidth: 1, borderColor: '#fca5a5',
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  errorText: { fontSize: FontSize.sm, color: Colors.error, fontWeight: '500' },

  nameRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: 0 },
  halfInput: { flex: 1 },

  input: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 13,
    fontSize: FontSize.md,
    color: Colors.text,
    backgroundColor: Colors.surfaceAlt,
    marginBottom: Spacing.sm,
  },

  submitBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: Spacing.sm,
    ...Shadow.sm,
  },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '700' },

  terms: { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center', marginTop: Spacing.lg },
  termsLink: { color: Colors.primary, fontWeight: '600' },
});
