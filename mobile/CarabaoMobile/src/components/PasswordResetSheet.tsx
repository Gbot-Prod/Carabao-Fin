// src/components/PasswordResetSheet.tsx
// Forgot password on mobile (E6): BetterAuth emails a reset link, the same one
// the website sends. The new password is chosen on the website and works in
// both places; then the user signs in here.
import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { authClient } from '../lib/authClient';
import { Colors, Spacing, Radius, FontSize } from '../lib/theme';

type Props = {
  visible: boolean;
  initialEmail: string;
  onClose: () => void;
  /** Called once the link is on its way, with the email it went to. */
  onDone: (email: string) => void;
};

export function PasswordResetSheet({ visible, initialEmail, onClose, onDone }: Props) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const close = () => {
    setError('');
    onClose();
  };

  const send = async () => {
    const address = email.trim();
    if (!address) return setError('Enter your account email.');
    setBusy(true);
    setError('');
    try {
      // Relative: BetterAuth builds the link on the website's own address.
      // It answers the same whether or not the email has an account.
      const { error: err } = await authClient.requestPasswordReset({
        email: address,
        redirectTo: '/reset-password',
      });
      if (err) {
        setError(err.status === 429 ? 'Too many requests. Wait a few minutes and try again.' : err.message || 'Could not send the reset email.');
        return;
      }
      onDone(address);
    } catch {
      setError('Could not reach Carabao. Check your connection.');
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
            Enter your account&apos;s email and we&apos;ll send you a link to choose a new password.
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

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

          <TouchableOpacity style={[styles.primary, busy && styles.disabled]} onPress={send} disabled={busy}>
            {busy ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.primaryText}>Send reset link</Text>}
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
