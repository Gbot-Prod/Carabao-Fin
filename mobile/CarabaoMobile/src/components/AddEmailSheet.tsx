// src/components/AddEmailSheet.tsx
// Adds (or changes) the account's email. BetterAuth sends a link to it and the
// email is saved only once that link is opened, so every address on an account
// is verified. Used for receipts and resetting the password by email.
import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { authClient } from '../lib/authClient';
import { Colors, Spacing, Radius, FontSize } from '../lib/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Called once the link is on its way, with the address it went to. */
  onSent: (email: string) => void;
};

export function AddEmailSheet({ visible, onClose, onSent }: Props) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const close = () => {
    setError('');
    onClose();
  };

  const send = async () => {
    const address = email.trim();
    if (!address.includes('@')) return setError('Enter a valid email address.');
    setBusy(true);
    setError('');
    try {
      // Relative: the link opens on the website, which confirms the address.
      const { error: err } = await authClient.changeEmail({ newEmail: address, callbackURL: '/email-verified' });
      if (err) {
        setError(err.status === 429 ? 'Too many requests. Wait a while and try again.' : err.message || 'Could not send the email.');
        return;
      }
      setEmail('');
      onSent(address);
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
          <Text style={styles.title}>Add an email</Text>
          <Text style={styles.sub}>
            For receipts and resetting your password by email. We&apos;ll send a link to confirm it.
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor={Colors.textLight}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          <TouchableOpacity style={[styles.primary, busy && styles.disabled]} onPress={send} disabled={busy}>
            {busy ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.primaryText}>Send link</Text>}
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
