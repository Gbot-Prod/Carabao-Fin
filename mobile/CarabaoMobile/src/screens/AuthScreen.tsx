// src/screens/AuthScreen.tsx
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
  Image, Dimensions,
} from 'react-native';
import { useAuth } from '../lib/AuthContext';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';

const { width } = Dimensions.get('window');

export default function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [form, setForm] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (key: string, val: string) =>
    setForm((p) => ({ ...p, [key]: val }));

  const handleSubmit = async () => {
    setError('');
    if (mode === 'signup' && form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (!form.email || !form.password) {
      setError('Please fill in all required fields');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'signin') {
        await signIn(form.email, form.password);
      } else {
        await signUp(form.email, form.password, form.firstName, form.lastName);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Authentication failed. Please try again.';
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
              <Text style={styles.logoEmoji}>🌿</Text>
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
              onPress={() => { setMode('signin'); setError(''); }}
            >
              <Text style={[styles.switchBtnText, mode === 'signin' && styles.switchBtnTextActive]}>
                Sign In
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.switchBtn, mode === 'signup' && styles.switchBtnActive]}
              onPress={() => { setMode('signup'); setError(''); }}
            >
              <Text style={[styles.switchBtnText, mode === 'signup' && styles.switchBtnTextActive]}>
                Sign Up
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.formTitle}>
            {mode === 'signin' ? 'Welcome back 👋' : 'Create account 🌱'}
          </Text>
          <Text style={styles.formSub}>
            {mode === 'signin'
              ? 'Sign in to continue your fresh journey'
              : 'Join thousands of happy farmers and buyers'}
          </Text>

          {/* Error */}
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠️  {error}</Text>
            </View>
          ) : null}

          {/* Fields */}
          {mode === 'signup' && (
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

          <TextInput
            style={styles.input}
            placeholder="Email address"
            placeholderTextColor={Colors.textLight}
            value={form.email}
            onChangeText={(v) => handleChange('email', v)}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={Colors.textLight}
            value={form.password}
            onChangeText={(v) => handleChange('password', v)}
            secureTextEntry
            autoComplete="password"
          />
          {mode === 'signup' && (
            <TextInput
              style={styles.input}
              placeholder="Confirm password"
              placeholderTextColor={Colors.textLight}
              value={form.confirmPassword}
              onChangeText={(v) => handleChange('confirmPassword', v)}
              secureTextEntry
            />
          )}

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
                {mode === 'signin' ? 'Sign In' : 'Create Account'}
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
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
  logoEmoji: { fontSize: 26 },
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
