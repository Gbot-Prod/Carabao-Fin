// src/components/ContactCodeField.tsx
// S17 (plan §5.12): the web onboarding/ContactCodeField.tsx on the phone. Send / enter / verify a
// 6-digit code for one contact value (email or SMS). The words are CONTACT_WORDS in
// src/lib/onboarding.ts; the resend wait is src/lib/useResendCooldown.ts (a minute between codes
// to one value, counted down on the screen).
//
// A different value makes a sent code not applicable: the screen renders this with
// `key={value}`, so a new value starts a fresh field (the web clears it in an effect).
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { codeDigits, CONTACT_WORDS } from '../lib/onboarding';
import { formatCountdown } from '../lib/resendCooldown';
import { Colors, FontSize, Radius, Spacing } from '../lib/theme';

type Props = {
  /** What the code goes to, e.g. "email" or "number"; used in the hints. */
  channel: string;
  /** The value being verified. */
  value: string;
  /** True when the value is proven (the account's own, or a code was entered). */
  verified: boolean;
  /** Shown when verified without a code (the account's own value). */
  accountNote?: string;
  disabled?: boolean;
  /** Returns an error message to show instead of sending, or null to send. */
  validate: () => string | null;
  onSend: () => Promise<void>;
  onVerify: (code: string) => Promise<void>;
  /** The screen's resend timer (one per form, so each value keeps its wait). */
  cooldown: {
    start: (target: string) => void;
    startFromError: (target: string, err: unknown) => void;
    secondsLeft: (target: string) => number;
  };
};

/** The server's words, else the fallback (the web errorHelper). */
const errorText = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

export default function ContactCodeField({
  channel, value, verified, accountNote, disabled, validate, onSend, onVerify, cooldown,
}: Props) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wait = cooldown.secondsLeft(value);

  const send = async () => {
    setError(null);
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    setSending(true);
    try {
      await onSend();
      setSent(true);
      setCode('');
      cooldown.start(value);
    } catch (err) {
      cooldown.startFromError(value, err);
      setError(errorText(err, CONTACT_WORDS.sendError));
    } finally {
      setSending(false);
    }
  };

  const verify = async () => {
    setError(null);
    setVerifying(true);
    try {
      await onVerify(code);
      setSent(false);
      setCode('');
    } catch (err) {
      setError(errorText(err, CONTACT_WORDS.verifyError));
    } finally {
      setVerifying(false);
    }
  };

  if (verified) {
    return (
      <Text style={styles.verified} accessibilityRole="text" accessibilityLiveRegion="polite">
        ✓ {accountNote ?? CONTACT_WORDS.verified(channel)}
      </Text>
    );
  }

  const resendOff = !!disabled || wait > 0 || sending;
  return (
    <View style={styles.wrap}>
      {!sent ? (
        <TouchableOpacity
          style={[styles.outline, (disabled || sending || !value.trim()) && styles.off]}
          onPress={() => void send()}
          disabled={disabled || sending || !value.trim()}
          accessibilityRole="button"
        >
          <Text style={styles.outlineText}>{sending ? CONTACT_WORDS.sending : CONTACT_WORDS.sendCode}</Text>
        </TouchableOpacity>
      ) : (
        <>
          <Text style={styles.hint}>{CONTACT_WORDS.hint(channel)}</Text>
          <View style={styles.row}>
            <TextInput
              style={styles.code}
              accessibilityLabel={CONTACT_WORDS.codeLabel(channel)}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="––––––"
              placeholderTextColor={Colors.textLight}
              value={code}
              onChangeText={(text) => setCode(codeDigits(text))}
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              editable={!disabled && !verifying}
            />
            <TouchableOpacity
              style={[styles.solid, (disabled || verifying || code.length < 6) && styles.off]}
              onPress={() => void verify()}
              disabled={disabled || verifying || code.length < 6}
              accessibilityRole="button"
            >
              {verifying
                ? <ActivityIndicator color={Colors.white} />
                : <Text style={styles.solidText}>{CONTACT_WORDS.verify}</Text>}
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.outline, resendOff && styles.off]}
            onPress={() => void send()}
            disabled={resendOff}
            accessibilityRole="button"
            accessibilityLiveRegion="polite"
          >
            <Text style={styles.outlineText}>
              {wait > 0 ? CONTACT_WORDS.resendIn(formatCountdown(wait)) : CONTACT_WORDS.resend}
            </Text>
          </TouchableOpacity>
        </>
      )}
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: Spacing.sm },
  verified: { marginTop: Spacing.sm, color: Colors.primaryDark, fontSize: FontSize.sm, fontWeight: '600' },
  hint: { fontSize: FontSize.xs, color: Colors.textMuted, marginBottom: 6 },
  row: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  code: {
    flex: 1, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 11, fontSize: FontSize.md,
    color: Colors.text, backgroundColor: Colors.white, letterSpacing: 4,
  },
  solid: {
    minWidth: 96, minHeight: 44, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.primary,
  },
  solidText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.sm },
  outline: {
    minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md, borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: Colors.primary, alignSelf: 'flex-start',
  },
  outlineText: { color: Colors.primary, fontWeight: '700', fontSize: FontSize.sm },
  off: { opacity: 0.5 },
  error: { color: Colors.error, fontSize: FontSize.xs, marginTop: 6 },
});
