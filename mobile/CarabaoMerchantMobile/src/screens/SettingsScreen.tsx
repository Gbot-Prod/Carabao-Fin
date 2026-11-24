// src/screens/SettingsScreen.tsx
// S16 (plan §5.11): Store settings, the mobile counterpart of the web merchant's shop page
// cards — Store details (address and pickup pin, contact number with its code, delivery fee,
// operating days), Shop close mode (CF-0066) and the danger zone that closes the farm. The
// rules and words live in src/lib/storeSettings.ts and src/lib/storePause.ts (pure, tested);
// this screen holds the state and the calls (backend api/routes/merchants.py).
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, RefreshControl, SafeAreaView, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View, type TextInputProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api, ApiError, type ApiMyMerchant, type MerchantSettingsPayload } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { hasPassword } from '../lib/authClient';
import { useMerchantGate } from '../lib/MerchantContext';
import AddressForm from '../components/AddressForm';
import { Badge, Button } from '../components/UI';
import { LoadError } from '../components/Skeleton';
import { formatPhMobile, normalizePhMobile } from '../lib/phone';
import { formatCountdown, resendLabel, resendSeconds, resendStart } from '../lib/payout';
import {
  EMPTY_ADDRESS, addressPayload, checkAddress,
  type AddressErrors, type AddressValue,
} from '../lib/pinLocation';
import {
  activePause, addDays, manilaToday, MAX_PAUSE_DAYS, pauseDateError, shortDay,
} from '../lib/storePause';
import {
  areaText, codeComplete, codeInput, CODE_PROBLEM, CODE_SENT_HINT, DAYS, DEFAULT_PAUSE_DAYS,
  daysProblem, daysText, DELETE_CODE_TARGET, DELETE_CONFIRM_ERROR, DELETE_SEND_ERROR,
  DELETE_START_ERROR, deliveryFeeProblem, formatLocalPhone, localPhoneFromStored, PAUSE_ERROR,
  PAUSE_MESSAGE_MAX, PHONE_PROBLEM, pinText, readDeleteError, RESUME_ERROR, SAVE_ERROR,
  SEND_CODE_ERROR, settingsFieldErrors, streetText, type DeleteError, type MerchantDay,
} from '../lib/storeSettings';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../lib/theme';

/** A failed call's sentence: the server's own words, else the fallback. */
function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

/** A secondary action (the web's .secondaryBtn): grey, full width, 44 points tall. */
function ActionButton({
  label, onPress, disabled,
}: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.secondary, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
    >
      <Text style={styles.secondaryText}>{label}</Text>
    </TouchableOpacity>
  );
}

/** A red action for the danger zone (the web's .dangerBtn / .dangerConfirmBtn). */
function DangerButton({
  label, onPress, disabled, loading,
}: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.danger, (disabled || loading) && styles.disabled]}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {loading ? (
        <ActivityIndicator color={Colors.white} />
      ) : (
        <Text style={styles.dangerText}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

/** A label, a box and its message, so every box on the form looks the same. */
function FieldInput({
  label, error, style, ...input
}: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, input.multiline && styles.textArea, error ? styles.inputBad : null, style]}
        placeholderTextColor={Colors.textLight}
        {...input}
      />
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

/** The delete refusal: the server's sentence and what is still open, one line each. */
function DeleteErrorBlock({ error }: { error: DeleteError }) {
  return (
    <View style={styles.errorBox} accessibilityRole="alert">
      <Text style={styles.errorText}>
        {error.items.length > 0 ? `${error.message.replace(/\.$/, '')}:` : error.message}
      </Text>
      {error.items.map((item) => (
        <Text key={item} style={styles.errorItem}>• {item}</Text>
      ))}
    </View>
  );
}

/** One chip (the web's .tickBtn), 44 points tall for a thumb. */
function DayChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, on && styles.chipOn]}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { token } = useAuth();
  // Closing the farm leaves the gate to notice: the profile is gone, so the app moves to
  // /not-merchant instead of signing the account out (plan §4.3).
  const { retry } = useMerchantGate();

  const [merchant, setMerchant] = useState<ApiMyMerchant | null>(null);
  const [today, setToday] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Store details, while editing.
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState<AddressValue>(EMPTY_ADDRESS);
  const [addressErrors, setAddressErrors] = useState<AddressErrors>({});
  const [phone, setPhone] = useState('');
  const [days, setDays] = useState<MerchantDay[]>([]);
  const [fee, setFee] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // CF-0030: a new contact number is saved only with a code sent to it.
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  // The code is used up once checked; keep its token in case the save then fails.
  const [verified, setVerified] = useState<{ number: string; token: string } | null>(null);

  // Shop close mode (CF-0066).
  const [until, setUntil] = useState('');
  const [message, setMessage] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [pausing, setPausing] = useState(false);

  // Danger zone: idle → the button, confirm → the password (when the account has one), code →
  // the code texted to the account's verified mobile number (web DangerZone.tsx).
  const [step, setStep] = useState<'idle' | 'confirm' | 'code'>('idle');
  const [needsPassword, setNeedsPassword] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [deleteCode, setDeleteCode] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<DeleteError | null>(null);

  // The resend timers: a minute to a number (web useResendCooldown). `now` moves once a
  // second while a wait runs (React's purity lint refuses Date.now() in the render body).
  const [contactWait, setContactWait] = useState<{ key: string; at: number } | null>(null);
  const [deleteWait, setDeleteWait] = useState<{ key: string; at: number } | null>(null);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    try {
      const data = await api.merchants.myMerchant(token);
      setMerchant(data);
      setToday(manilaToday());
      setLoadError(null);
    } catch (err) {
      setLoadError(errorText(err, 'Could not load your store settings.'));
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // ── Store details ──────────────────────────────────────────────────────────

  const newNumber = normalizePhMobile(phone);
  const currentNumber = normalizePhMobile(merchant?.contact_number ?? '');
  const numberChanged = phone.trim() !== '' && newNumber !== currentNumber;
  const resendIn = resendSeconds(contactWait, newNumber ?? '', now);

  const startEditing = () => {
    if (!merchant) return;
    setAddress({
      region: merchant.region ?? '',
      province: merchant.province ?? '',
      city: merchant.city ?? '',
      barangay: merchant.barangay ?? '',
      postal_code: merchant.postal_code ?? '',
      street: merchant.address ?? '',
      latitude: merchant.lat,
      longitude: merchant.lng,
      pin_confirmed: merchant.pin_confirmed,
    });
    setAddressErrors({});
    setPhone(localPhoneFromStored(merchant.contact_number));
    setDays(DAYS.filter((d) => merchant.available_days.includes(d)));
    setFee(merchant.delivery_price != null ? String(merchant.delivery_price) : '');
    setFormError(null);
    setCodeSentTo(null);
    setCode('');
    setVerified(null);
    setEditing(true);
  };

  const toggleDay = (day: MerchantDay) => {
    setDays((prev) => {
      const set = new Set(prev);
      if (set.has(day)) set.delete(day); else set.add(day);
      return DAYS.filter((d) => set.has(d));
    });
  };

  const sendContactCode = async () => {
    setFormError(null);
    if (!newNumber) {
      setFormError(PHONE_PROBLEM);
      return;
    }
    setSendingCode(true);
    try {
      await api.sms.send(token, newNumber);
      setCodeSentTo(newNumber);
      setCode('');
      setContactWait(resendStart(newNumber));
      setNow(Date.now());
    } catch (err) {
      setFormError(errorText(err, SEND_CODE_ERROR));
    } finally {
      setSendingCode(false);
    }
  };

  const save = async () => {
    setFormError(null);
    const errors = checkAddress(address);
    setAddressErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const daysMessage = daysProblem(days);
    if (daysMessage) {
      setFormError(daysMessage);
      return;
    }
    const feeMessage = deliveryFeeProblem(fee);
    if (feeMessage) {
      setFormError(feeMessage);
      return;
    }
    if (numberChanged && !newNumber) {
      setFormError(PHONE_PROBLEM);
      return;
    }
    const haveToken = verified?.number === newNumber;
    if (numberChanged && !haveToken && (codeSentTo !== newNumber || !codeComplete(code))) {
      setFormError(CODE_PROBLEM);
      return;
    }

    setSaving(true);
    try {
      // The code is checked once; if the save then fails, the token it answered still stands.
      let phoneToken: string | null = null;
      if (numberChanged && newNumber) {
        phoneToken = haveToken && verified
          ? verified.token
          : await api.sms.verify(token, newNumber, code);
        setVerified({ number: newNumber, token: phoneToken });
      }
      const place = addressPayload(address);
      const payload: MerchantSettingsPayload = {
        region: place.region,
        province: place.province,
        city: place.city || null,
        barangay: place.barangay || null,
        address: place.address,
        postal_code: place.postal_code,
        lat: place.latitude,
        lng: place.longitude,
        pin_confirmed: place.pin_confirmed,
        available_days: days,
        delivery_price: fee.trim() === '' ? null : Number(fee),
        ...(numberChanged && newNumber
          ? { contact_number: newNumber, phone_verification_token: phoneToken }
          : {}),
      };
      const updated = await api.merchants.updateMyMerchant(token, payload);
      setMerchant(updated);
      setPhone(localPhoneFromStored(updated.contact_number));
      setEditing(false);
      setToday(manilaToday());
    } catch (err) {
      setAddressErrors((prev) => ({
        ...prev,
        ...settingsFieldErrors(err instanceof ApiError ? err.fieldErrors : {}),
      }));
      setFormError(errorText(err, SAVE_ERROR));
    } finally {
      setSaving(false);
    }
  };

  // ── Shop close mode (CF-0066) ──────────────────────────────────────────────

  const pausedThrough = merchant && today ? activePause(merchant.paused_until, today) : null;
  const untilValue = until || (today ? addDays(today, DEFAULT_PAUSE_DAYS) : '');

  const pause = async () => {
    const problem = pauseDateError(untilValue, today || undefined);
    if (problem) {
      setDateError(problem);
      return;
    }
    setDateError(null);
    setPauseError(null);
    setPausing(true);
    try {
      const updated = await api.merchants.pauseStore(token, untilValue, message.trim() || null);
      setMerchant(updated);
      setMessage('');
      setUntil('');
      setToday(manilaToday());
    } catch (err) {
      setPauseError(errorText(err, PAUSE_ERROR));
    } finally {
      setPausing(false);
    }
  };

  const resume = async () => {
    setPauseError(null);
    setPausing(true);
    try {
      const updated = await api.merchants.resumeStore(token);
      setMerchant(updated);
      setToday(manilaToday());
    } catch (err) {
      setPauseError(errorText(err, RESUME_ERROR));
    } finally {
      setPausing(false);
    }
  };

  // ── Danger zone ────────────────────────────────────────────────────────────

  const deleteLeft = resendSeconds(deleteWait, DELETE_CODE_TARGET, now);

  // One tick a second, and only while a wait still runs — after that the screen rests.
  const waiting = resendIn > 0 || deleteLeft > 0;
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  /** First tap: the confirm step, which asks for the password only when the account has one. */
  const startDelete = async () => {
    if (step !== 'idle') return;
    setDeleteError(null);
    setDeleting(true);
    try {
      setNeedsPassword(await hasPassword());
      setPassword('');
      setStep('confirm');
    } catch (err) {
      setDeleteError(readDeleteError(err, DELETE_START_ERROR));
    } finally {
      setDeleting(false);
    }
  };

  /** Asks for the code that closes the farm; the password goes along when the account has one. */
  const sendDeleteCode = async (withPassword: string | null) => {
    setDeleteError(null);
    setDeleting(true);
    try {
      const result = await api.merchants.sendDeleteCode(token, withPassword ?? undefined);
      setSentTo(result.sent_to);
      setDeleteCode('');
      setStep('code');
      setDeleteWait(resendStart(DELETE_CODE_TARGET));
      setNow(Date.now());
    } catch (err) {
      setDeleteError(readDeleteError(err, DELETE_SEND_ERROR));
    } finally {
      setDeleting(false);
    }
  };

  const confirmDelete = async () => {
    if (!codeComplete(deleteCode)) {
      setDeleteError({ message: 'Enter the six-digit code we texted you.', items: [] });
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    try {
      await api.merchants.deleteMerchant(token, deleteCode);
      // The gate asks again: with the profile gone it sends the account to /not-merchant.
      retry();
    } catch (err) {
      setDeleteError(readDeleteError(err, DELETE_CONFIRM_ERROR));
    } finally {
      setDeleting(false);
    }
  };

  /** Back to the start from any step; the typed password and code go with it. */
  const cancelDelete = () => {
    setStep('idle');
    setPassword('');
    setDeleteCode('');
    setSentTo('');
    setDeleteError(null);
    setDeleteWait(null);
  };

  // ── The screen ─────────────────────────────────────────────────────────────

  if (!merchant) {
    return (
      <SafeAreaView style={styles.screen}>
        {loadError ? (
          <LoadError message={loadError} onRetry={() => void load()} />
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Loading your store…</Text>
          </View>
        )}
      </SafeAreaView>
    );
  }

  const paused = pausedThrough !== null;
  const contactShown = formatPhMobile(merchant.contact_number) || 'No contact number yet';
  const feeShown = merchant.delivery_price == null
    ? 'No flat delivery fee'
    : `₱${merchant.delivery_price.toLocaleString('en-PH')} per delivery`;
  const codeSent = codeSentTo !== null && codeSentTo === newNumber;
  const codeVerified = verified !== null && verified.number === newNumber;
  const canSendCode = numberChanged && resendIn === 0 && !sendingCode && !saving;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.back}
        >
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Store settings</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.primary} />
        }
      >
        <Text style={styles.subtitle}>What buyers see, and when you are open.</Text>

        {/* ── Store details ─────────────────────────────────────────────── */}
        <Text style={styles.section}>Store details</Text>
        {!editing ? (
          <View style={styles.card}>
            <View style={styles.rowTop}>
              <Text style={styles.farm} numberOfLines={2}>{merchant.merchant_name}</Text>
              {paused ? <Badge label="Paused" color="yellow" /> : null}
            </View>
            <Text style={styles.line}>{areaText(merchant) || 'No address saved yet'}</Text>
            <Text style={styles.line}>{streetText(merchant) || 'No street or postal code'}</Text>
            <Text style={styles.lineMuted}>{pinText(merchant)}</Text>
            <View style={styles.gap} />
            <Text style={styles.line}>{contactShown}</Text>
            <Text style={styles.line}>{feeShown}</Text>
            <Text style={styles.line}>{daysText(merchant.available_days) || 'No operating days set'}</Text>

            <ActionButton label="Edit store details" onPress={startEditing} />
          </View>
        ) : null}

        {editing ? (
          <View style={styles.card}>
            <Text style={styles.farm} numberOfLines={2}>{merchant.merchant_name}</Text>

            <AddressForm
              value={address}
              onChange={setAddress}
              errors={addressErrors}
              token={token}
              disabled={saving}
            />

            <View style={styles.field}>
              <Text style={styles.label}>Contact number</Text>
              <View style={styles.phoneRow}>
                <Text style={styles.prefix}>+63</Text>
                <TextInput
                  style={[styles.input, styles.phoneInput]}
                  value={phone}
                  onChangeText={(text) => {
                    setPhone(formatLocalPhone(text));
                    setFormError(null);
                  }}
                  placeholder="917 123 4567"
                  placeholderTextColor={Colors.textLight}
                  keyboardType="phone-pad"
                  editable={!saving}
                  accessibilityLabel="Contact number"
                />
              </View>
              {numberChanged ? (
                <>
                  <Text style={styles.hint}>{CODE_SENT_HINT}</Text>
                  <View style={styles.phoneRow}>
                    <TextInput
                      style={[styles.input, styles.codeInput]}
                      value={code}
                      onChangeText={(text) => {
                        setCode(codeInput(text));
                        setFormError(null);
                      }}
                      placeholder="000000"
                      placeholderTextColor={Colors.textLight}
                      keyboardType="number-pad"
                      maxLength={6}
                      editable={!saving}
                      accessibilityLabel="Code sent to the new number"
                    />
                    <TouchableOpacity
                      style={[styles.sendCode, !canSendCode && styles.disabled]}
                      onPress={() => void sendContactCode()}
                      disabled={!canSendCode}
                      accessibilityRole="button"
                    >
                      {sendingCode ? (
                        <ActivityIndicator color={Colors.primary} />
                      ) : (
                        <Text style={styles.sendCodeText}>
                          {resendIn > 0
                            ? formatCountdown(resendIn)
                            : codeSent ? 'Send again' : 'Send code'}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                  {codeVerified ? (
                    <Text style={styles.hint}>
                      Number verified. Save the store details to finish.
                    </Text>
                  ) : codeSent ? (
                    <Text style={styles.hint}>Code sent to {formatPhMobile(codeSentTo)}.</Text>
                  ) : null}
                </>
              ) : null}
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Operating days</Text>
              <View style={styles.chips}>
                {DAYS.map((day) => (
                  <DayChip
                    key={day}
                    label={day}
                    on={days.includes(day)}
                    onPress={() => { toggleDay(day); setFormError(null); }}
                  />
                ))}
              </View>
            </View>

            <FieldInput
              label="Flat delivery fee (₱)"
              value={fee}
              onChangeText={(text) => { setFee(text.replace(/[^\d]/g, '')); setFormError(null); }}
              placeholder="0"
              keyboardType="number-pad"
              editable={!saving}
            />

            {formError ? (
              <View style={styles.errorBox} accessibilityRole="alert">
                <Text style={styles.errorText}>{formError}</Text>
              </View>
            ) : null}

            <Button
              label="Save store details"
              onPress={() => void save()}
              loading={saving}
              fullWidth
              style={styles.save}
            />
            <ActionButton
              label="Cancel"
              disabled={saving}
              onPress={() => { setEditing(false); setFormError(null); setAddressErrors({}); }}
            />
          </View>
        ) : null}

        {/* ── Shop close mode (CF-0066) ─────────────────────────────────── */}
        <Text style={styles.section}>Shop close mode</Text>
        <View style={styles.card}>
          {paused && pausedThrough ? (
            <>
              <Text style={styles.line}>
                Your shop is closed until <Text style={styles.strong}>{shortDay(pausedThrough)}</Text>.
                Buyers can still look, but cannot order.
              </Text>
              {merchant.pause_message ? (
                <Text style={styles.quote}>“{merchant.pause_message}”</Text>
              ) : null}
              {pauseError ? (
                <View style={styles.errorBox} accessibilityRole="alert">
                  <Text style={styles.errorText}>{pauseError}</Text>
                </View>
              ) : null}
              <Button
                label="Open my shop again"
                onPress={() => void resume()}
                loading={pausing}
                fullWidth
              />
            </>
          ) : (
            <>
              <Text style={styles.line}>
                Taking a break? Your shop stops taking orders until the last day you pick, up to{' '}
                {MAX_PAUSE_DAYS} days out.
              </Text>

              <View style={styles.chips}>
                {[3, 7, 14, 30].map((n) => {
                  const day = today ? addDays(today, n) : '';
                  return (
                    <DayChip
                      key={n}
                      label={shortDay(day)}
                      on={untilValue === day}
                      onPress={() => { setUntil(day); setDateError(null); }}
                    />
                  );
                })}
              </View>

              <FieldInput
                label="Last day of the break"
                value={untilValue}
                onChangeText={(text) => { setUntil(text.trim()); setDateError(null); }}
                placeholder="YYYY-MM-DD"
                autoCapitalize="none"
                error={dateError}
                editable={!pausing}
              />

              <FieldInput
                label="A note for buyers (optional)"
                value={message}
                onChangeText={(text) => { setMessage(text.slice(0, PAUSE_MESSAGE_MAX)); setPauseError(null); }}
                placeholder="Back after the harvest festival."
                multiline
                maxLength={PAUSE_MESSAGE_MAX}
                editable={!pausing}
              />
              <Text style={styles.counter}>{message.length}/{PAUSE_MESSAGE_MAX}</Text>

              {pauseError ? (
                <View style={styles.errorBox} accessibilityRole="alert">
                  <Text style={styles.errorText}>{pauseError}</Text>
                </View>
              ) : null}

              <Button label="Pause my shop" onPress={() => void pause()} loading={pausing} fullWidth />
            </>
          )}
        </View>

        {/* ── Danger zone ───────────────────────────────────────────────── */}
        <Text style={styles.section}>Danger zone</Text>
        <View style={[styles.card, styles.dangerCard]}>
          <Text style={styles.dangerTitle}>Close this farm</Text>
          <Text style={styles.line}>
            Your listings, orders and shop page are removed and buyers can no longer find you.
            This cannot be undone.
          </Text>

          {step === 'idle' ? (
            <>
              <DangerButton
                label="Delete my farm"
                onPress={() => void startDelete()}
                loading={deleting}
              />
              {deleteError ? <DeleteErrorBlock error={deleteError} /> : null}
            </>
          ) : null}

          {step === 'confirm' ? (
            <>
              <Text style={styles.line}>
                Your order history is kept. You cannot undo it.{' '}
                {needsPassword
                  ? 'Type your current password. Then we send a code to your mobile number.'
                  : 'We send a code to your mobile number. Type it to delete your farm.'}
              </Text>
              {needsPassword ? (
                <FieldInput
                  label="Current password"
                  value={password}
                  onChangeText={(text) => { setPassword(text); setDeleteError(null); }}
                  placeholder="Password"
                  secureTextEntry
                  autoCapitalize="none"
                  editable={!deleting}
                />
              ) : null}
              {deleteError ? <DeleteErrorBlock error={deleteError} /> : null}
              <DangerButton
                label="Send the code"
                onPress={() => void sendDeleteCode(needsPassword ? password : null)}
                disabled={!!needsPassword && password.trim() === ''}
                loading={deleting}
              />
              <ActionButton label="Keep my farm" onPress={cancelDelete} disabled={deleting} />
            </>
          ) : null}

          {step === 'code' ? (
            <>
              <Text style={styles.line}>
                We sent a code to your number ending in {sentTo || '****'}. Type it to delete your
                farm for good.
              </Text>
              <FieldInput
                label="Six-digit code"
                value={deleteCode}
                onChangeText={(text) => { setDeleteCode(codeInput(text)); setDeleteError(null); }}
                placeholder="123456"
                keyboardType="number-pad"
                maxLength={6}
                editable={!deleting}
              />
              {deleteError ? <DeleteErrorBlock error={deleteError} /> : null}
              <DangerButton
                label="Yes, delete my farm"
                onPress={() => void confirmDelete()}
                disabled={!codeComplete(deleteCode)}
                loading={deleting}
              />
              <ActionButton
                label={resendLabel(deleteLeft)}
                onPress={() => void sendDeleteCode(needsPassword ? password : null)}
                disabled={deleting || deleteLeft > 0}
              />
              <ActionButton label="Keep my farm" onPress={cancelDelete} disabled={deleting} />
            </>
          ) : null}
        </View>

        <Text style={styles.footnote}>
          Deleting the farm keeps your Carabao account. To remove the account itself,
          contact support.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.offWhite },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl * 2 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  loadingText: { color: Colors.textMuted, fontSize: FontSize.sm },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm, backgroundColor: Colors.white,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  subtitle: { fontSize: FontSize.sm, color: Colors.textMuted, lineHeight: 20, marginBottom: Spacing.sm },

  section: {
    fontSize: FontSize.xs, fontWeight: '800', color: Colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.6,
    marginTop: Spacing.lg, marginBottom: Spacing.sm,
  },
  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg,
    marginBottom: Spacing.sm, ...Shadow.sm,
  },
  rowTop: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm,
  },
  farm: { flex: 1, fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  line: { fontSize: FontSize.sm, color: Colors.text, marginTop: 6, lineHeight: 20 },
  lineMuted: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 4 },
  strong: { fontWeight: '700' },
  quote: {
    fontSize: FontSize.sm, color: Colors.textMuted, fontStyle: 'italic', marginTop: Spacing.sm,
    borderLeftWidth: 3, borderLeftColor: Colors.border, paddingLeft: Spacing.sm,
  },
  gap: { height: Spacing.sm },
  footnote: {
    fontSize: FontSize.xs, color: Colors.textMuted, marginTop: Spacing.sm, lineHeight: 16,
  },

  field: { marginTop: Spacing.md },
  label: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600', marginBottom: 6 },
  input: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 11, fontSize: FontSize.md,
    color: Colors.text, backgroundColor: Colors.white,
  },
  inputBad: { borderColor: Colors.error },
  textArea: { minHeight: 88, textAlignVertical: 'top' },
  error: { color: Colors.error, fontSize: FontSize.xs, marginTop: 4 },
  hint: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 6, lineHeight: 16 },
  counter: { fontSize: FontSize.xs, color: Colors.textLight, textAlign: 'right', marginTop: 2 },

  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 0 },
  prefix: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textMuted },
  phoneInput: { flex: 1 },
  codeInput: { flex: 1, letterSpacing: 2, marginTop: 0 },
  sendCode: {
    minWidth: 96, minHeight: 44, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: Spacing.md, borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: Colors.primary,
  },
  sendCodeText: { color: Colors.primary, fontWeight: '700', fontSize: FontSize.sm },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
  chip: {
    minWidth: 56, minHeight: 44, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: Spacing.md, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  chipOn: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  chipText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textMuted },
  chipTextOn: { color: Colors.primaryDark, fontWeight: '700' },

  save: { marginTop: Spacing.lg },
  secondary: {
    minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.sm,
    paddingVertical: 12, borderRadius: Radius.md, backgroundColor: Colors.borderLight,
  },
  secondaryText: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  disabled: { opacity: 0.6 },

  dangerCard: { borderWidth: 1, borderColor: Colors.errorBg },
  dangerTitle: { fontSize: FontSize.md, fontWeight: '800', color: Colors.error },
  danger: {
    minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.md,
    paddingVertical: 13, borderRadius: Radius.md, backgroundColor: Colors.error,
  },
  dangerText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '700' },

  errorBox: {
    marginTop: Spacing.md, padding: Spacing.md, borderRadius: Radius.md,
    backgroundColor: Colors.errorBg, gap: 2,
  },
  errorText: { color: Colors.error, fontSize: FontSize.sm, lineHeight: 18 },
  errorItem: { color: Colors.error, fontSize: FontSize.sm, lineHeight: 18 },
});
