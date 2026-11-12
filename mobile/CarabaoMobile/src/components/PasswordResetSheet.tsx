// src/components/PasswordResetSheet.tsx
// Forgot password on mobile (E6): email a 6-digit code, then set a new password.
// Same backend as the app's sign-in; it also updates the web password.
import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { request } from '../lib/api';
import { Colors, Spacing, Radius, FontSize } from '../lib/theme';

type Props = {
  visible: boolean;
  initialEmail: string;
  onClose: () => void;
  /** Called after the password changed, with the email to sign in with. */
  onDone: (email: string) => void;
};

const MIN_LENGTH = 8;

export function PasswordResetSheet({ visible, initialEmail, onClose, onDone }: Props) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setStep('email');
    setCode('');
    setPassword('');
    setConfirm('');
    setError('');
  };

  const close = () => {
    reset();
    onClose();
  };

  const sendCode = async () => {
    if (!email.trim()) return setError('Enter your account email.');
    setBusy(true);
    setError('');
    try {
      await request('/auth/mobile/password-reset/request', null, {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!/^\d{6}$/.test(code.trim())) return setError('Enter the 6-digit code from the email.');
    if (password.length < MIN_LENGTH) return setError(`Use at least ${MIN_LENGTH} characters.`);
    if (password !== confirm) return setError('The passwords do not match.');
    setBusy(true);
    setError('');
    try {
      await request('/auth/mobile/password-reset/confirm', null, {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), otp: code.trim(), new_password: password }),
      });
      const done = email.trim();
      reset();
      onDone(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Reset your password</Text>
          <Text style={styles.sub}>
            {step === 'email'
              ? "Enter your account's email and we'll send you a 6-digit code."
              : `If ${email.trim()} has an account, a code is on its way. Enter it with your new password.`}
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {step === 'email' ? (
            <TextInput
              style={styles.input}
              placeholder="Email address"
              placeholderTextColor={Colors.textLight}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
          ) : (
            <>
              <TextInput
                style={styles.input}
                placeholder="6-digit code"
                placeholderTextColor={Colors.textLight}
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={6}
                autoComplete="one-time-code"
              />
              <TextInput
                style={styles.input}
                placeholder="New password"
                placeholderTextColor={Colors.textLight}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                maxLength={72}
                autoComplete="password-new"
              />
              <TextInput
                style={styles.input}
                placeholder="Confirm new password"
                placeholderTextColor={Colors.textLight}
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                maxLength={72}
              />
            </>
          )}

          <TouchableOpacity
            style={[styles.primary, busy && styles.disabled]}
            onPress={step === 'email' ? sendCode : save}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={styles.primaryText}>{step === 'email' ? 'Send code' : 'Save new password'}</Text>
            )}
          </TouchableOpacity>
          {step === 'code' && (
            <TouchableOpacity onPress={sendCode} disabled={busy}>
              <Text style={styles.link}>Send a new code</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={close}>
            <Text style={styles.link}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    backgroundColor: Colors.white, padding: Spacing.xl,
    borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg, gap: Spacing.md,
  },
  title: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textMuted, lineHeight: 20 },
  error: { fontSize: FontSize.sm, color: Colors.error },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    fontSize: FontSize.md, color: Colors.text, backgroundColor: Colors.white,
  },
  primary: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: Spacing.md, alignItems: 'center',
  },
  disabled: { opacity: 0.6 },
  primaryText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.md },
  link: { textAlign: 'center', color: Colors.primary, fontWeight: '600', fontSize: FontSize.sm, paddingVertical: 4 },
});
