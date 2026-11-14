// src/components/PhoneVerifySheet.tsx
// Adds or changes the account's mobile number: we text a code, and entering it
// saves the number as verified (BetterAuth phoneNumber plugin). Checkout,
// merchant applications and order chat need one; the backend answers
// PHONE_VERIFICATION_REQUIRED until there is (isPhoneVerificationRequired).
import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { formatPhMobile } from '../lib/phone';
import { Colors, Spacing, Radius, FontSize } from '../lib/theme';

/** The backend refused because the account has no verified mobile number. */
export const isPhoneVerificationRequired = (err: unknown): boolean =>
  err instanceof ApiError && err.status === 403 && err.message === 'PHONE_VERIFICATION_REQUIRED';

type Props = {
  visible: boolean;
  /** Why we're asking, e.g. "Checkout needs a verified mobile number." */
  reason?: string;
  onClose: () => void;
  /** Called once the number is verified and saved to the account. */
  onVerified: () => void;
};

export function PhoneVerifySheet({ visible, reason, onClose, onVerified }: Props) {
  const { user, sendPhoneCode, verifyPhone } = useAuth();
  const [phone, setPhone] = useState(user?.phoneNumber ? formatPhMobile(user.phoneNumber) : '');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const close = () => {
    setError('');
    setCodeSent(false);
    setCode('');
    onClose();
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (!codeSent) {
        await sendPhoneCode(phone);
        setCodeSent(true);
      } else {
        await verifyPhone(phone, code);
        setCodeSent(false);
        setCode('');
        onVerified();
      }
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Verify your mobile number</Text>
          <Text style={styles.sub}>{reason ?? "We'll text you a 6-digit code."}</Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TextInput
            style={styles.input}
            placeholder="Mobile number, e.g. 0912 345 6789"
            placeholderTextColor={Colors.textLight}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            editable={!codeSent && !busy}
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
                autoFocus
              />
              <TouchableOpacity onPress={() => { setCodeSent(false); setCode(''); }} disabled={busy}>
                <Text style={styles.link}>Use a different number</Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity style={[styles.primary, busy && styles.disabled]} onPress={submit} disabled={busy}>
            {busy ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={styles.primaryText}>{codeSent ? 'Verify' : 'Text me a code'}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={close} disabled={busy}>
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
