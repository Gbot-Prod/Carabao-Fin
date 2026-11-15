// src/components/PasswordResetSheet.tsx
// Forgot password on mobile (E6). With a mobile number we text a code and the
// new password is set right here. With an email the account has verified,
// BetterAuth emails the same reset link the website sends.
import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { authClient } from '../lib/authClient';
import { codeMessage, requirePhone } from '../lib/AuthContext';
import { Colors, Spacing, Radius, FontSize } from '../lib/theme';

type Props = {
  visible: boolean;
  initialIdentifier: string;
  onClose: () => void;
  /** Called once the password is reset (phone) or the link is on its way (email). */
  onDone: (result: { identifier: string; byEmail: boolean }) => void;
};

export function PasswordResetSheet({ visible, initialIdentifier, onClose, onDone }: Props) {
  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const byEmail = identifier.includes('@');

  const close = () => {
    setError('');
    setCodeSent(false);
    setCode('');
    setPassword('');
    onClose();
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not reach Carabao. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const value = identifier.trim();
    if (!value) return setError('Enter your mobile number or email.');
    if (byEmail) {
      return void run(async () => {
        // Relative: BetterAuth builds the link on the website's own address.
        // It answers the same whether or not the email has an account.
        const { error: err } = await authClient.requestPasswordReset({ email: value, redirectTo: '/reset-password' });
        if (err) throw new Error(err.status === 429 ? 'Too many requests. Wait a few minutes and try again.' : err.message || 'Could not send the reset email.');
        onDone({ identifier: value, byEmail: true });
      });
    }
    if (!codeSent) {
      return void run(async () => {
        const { error: err } = await authClient.phoneNumber.requestPasswordReset({ phoneNumber: requirePhone(value) });
        if (err) throw new Error(err.message || "We couldn't send the code.");
        setCodeSent(true);
      });
    }
    if (password.length < 8) return setError('Use at least 8 characters.');
    void run(async () => {
      const { error: err } = await authClient.phoneNumber.resetPassword({
        phoneNumber: requirePhone(value),
        otp: code.trim(),
        newPassword: password,
      });
      if (err) throw new Error(codeMessage(err));
      setCodeSent(false);
      setCode('');
      setPassword('');
      onDone({ identifier: value, byEmail: false });
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Reset your password</Text>
          <Text style={styles.sub}>
            {codeSent
              ? 'If an account uses that number, a code is on its way. Enter it with your new password.'
              : "Enter your account's mobile number and we'll text you a code. Added an email? You can use that instead."}
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TextInput
            style={styles.input}
            placeholder="Mobile number or email"
            placeholderTextColor={Colors.textLight}
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
            autoComplete="username"
            editable={!codeSent}
          />
          {codeSent && (
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
                autoComplete="password-new"
                maxLength={128}
              />
            </>
          )}

          <TouchableOpacity style={[styles.primary, busy && styles.disabled]} onPress={submit} disabled={busy}>
            {busy ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={styles.primaryText}>
                {byEmail ? 'Send reset link' : codeSent ? 'Save new password' : 'Text me a code'}
              </Text>
            )}
          </TouchableOpacity>
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
