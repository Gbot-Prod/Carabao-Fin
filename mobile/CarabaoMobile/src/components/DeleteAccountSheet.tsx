// CF-0122: delete the account (web profile danger zone). Step 1: type DELETE and
// the password (blank for Google / no-password accounts) → the server texts a code
// (or refuses with 409 when open orders or payouts block it). Step 2: the code →
// DELETE /users/me → sign out, which wipes everything this app holds.
import React, { useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { api } from '../lib/api';
import { checkDeleteCode, codeRequestBody, CONFIRM_WORD, confirmed, DELETE_CODE_MAX, DELETE_PASSWORD_MAX, sentToText } from '../lib/accountDeletion';
import { Colors, Spacing, Radius, FontSize } from '../lib/theme';
import { Button } from './UI';

type Props = { visible: boolean; token: string | null; onClose: () => void; onDeleted: () => void };

export function DeleteAccountSheet({ visible, token, onClose, onDeleted }: Props) {
  const [step, setStep] = useState<'confirm' | 'code'>('confirm');
  const [word, setWord] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setStep('confirm'); setWord(''); setPassword(''); setCode(''); setError(null);
    onClose();
  };

  const sendCode = async () => {
    const body = codeRequestBody(password);
    if ('error' in body) return setError(body.error);
    setBusy(true);
    setError(null);
    try {
      const res = await api.users.deleteCode(token, body);
      setSentTo(res.sent_to);
      setPassword('');
      setStep('code');
    } catch (err) {
      // e.g. "Your password is not correct." or 409 open orders / payouts.
      setError(err instanceof Error ? err.message : 'Could not send the code.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const c = checkDeleteCode(code);
    if ('error' in c) return setError(c.error);
    setBusy(true);
    setError(null);
    try {
      await api.users.deleteAccount(token, c.code);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The account was not deleted.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>Delete account</Text>
            {step === 'confirm' ? (
              <>
                <Text style={styles.text}>
                  This deletes your account, saved addresses, cart, saved produce and order history. It cannot be undone.
                  Orders that are still open or money still owed can stop it.
                </Text>
                <Text style={styles.label}>Type {CONFIRM_WORD} to continue</Text>
                <TextInput
                  style={styles.input} value={word} onChangeText={setWord} autoCapitalize="characters" autoCorrect={false}
                  maxLength={12} accessibilityLabel={`Type ${CONFIRM_WORD} to continue`}
                />
                <Text style={styles.label}>Password (leave blank if you sign in with Google)</Text>
                <TextInput
                  style={styles.input} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none"
                  autoCorrect={false} maxLength={DELETE_PASSWORD_MAX} textContentType="password" accessibilityLabel="Password"
                />
                {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
                <Button label="Text me a code" onPress={sendCode} loading={busy} disabled={!confirmed(word)} fullWidth style={{ marginTop: Spacing.lg }} />
              </>
            ) : (
              <>
                <Text style={styles.text}>We sent a code to {sentToText(sentTo)}. Enter it to delete your account now.</Text>
                <TextInput
                  style={styles.input} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={DELETE_CODE_MAX + 4}
                  textContentType="oneTimeCode" autoComplete="sms-otp" accessibilityLabel="Code from the text message"
                />
                {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
                <TouchableOpacity style={styles.danger} onPress={remove} disabled={busy} accessibilityRole="button">
                  <Text style={styles.dangerText}>{busy ? 'Deleting…' : 'Delete my account'}</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity style={styles.cancel} onPress={close} disabled={busy} accessibilityRole="button">
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: Colors.white, padding: Spacing.lg, maxHeight: '90%', borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg },
  title: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.error, marginBottom: Spacing.sm },
  text: { fontSize: FontSize.sm, color: Colors.text, lineHeight: 20 },
  label: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600', marginTop: Spacing.md, marginBottom: 6 },
  input: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: Spacing.md, minHeight: 44,
    fontSize: FontSize.md, color: Colors.text, backgroundColor: Colors.surfaceAlt, marginTop: Spacing.sm,
  },
  error: { color: Colors.error, fontSize: FontSize.sm, marginTop: Spacing.md },
  danger: { marginTop: Spacing.lg, minHeight: 48, borderRadius: Radius.md, backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center' },
  dangerText: { color: Colors.white, fontWeight: '800', fontSize: FontSize.md },
  cancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.sm },
  cancelText: { color: Colors.textMuted, fontWeight: '600', fontSize: FontSize.md },
});
