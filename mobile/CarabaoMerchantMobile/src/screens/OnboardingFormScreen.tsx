// src/screens/OnboardingFormScreen.tsx
// S17 + S18 (plan §5.12): the native merchant application. The web form
// (app/(site)/(merchant)/merchant/onboarding/page.tsx) is the spec; its rules and words are in
// src/lib/onboarding.ts (pure, tested).
// Step 1, "Operations & Contact": the shop name, the pickup address with its pin (AddressForm),
// the available days, and the contact email and number, each proven with a code
// (ContactCodeField, resend wait as the web). "Continue" checks step 1 as the web goNext does.
// Step 2, "Business Information": submit now or later, the seller type, the names, tax details
// and the documents (expo-document-picker, checked with the S2 rules before they are kept).
// "Submit later" sends step 1 and the seller type only; "Submit" sends all. Server field errors
// go to the first step with a problem, each under its field; other server words (a 429 too)
// show at the top. PHONE_VERIFICATION_REQUIRED opens the phone sheet, then submits again.
// src/screens/OnboardingScreen.tsx (route /onboarding) mounts this screen.
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Platform, SafeAreaView, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { api, ApiError, WEB_BASE, type ApiMerchantApplication } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import AddressForm from '../components/AddressForm';
import ContactCodeField from '../components/ContactCodeField';
import { isPhoneVerificationRequired, PhoneVerifySheet } from '../components/PhoneVerifySheet';
import { Button } from '../components/UI';
import { normalizePhMobile } from '../lib/phone';
import { DAYS, type MerchantDay } from '../lib/storeSettings';
import { useResendCooldown } from '../lib/useResendCooldown';
import { DOCUMENT_TYPES } from '../lib/uploads';
import { webPageUrl } from '../lib/webPages';
import {
  addressErrorsOf, buildPayload, COMPANY_MAX, contactState, CONTACT_WORDS, DOCUMENT_LABELS,
  documentError, documentMeta, documentsIntro, emailSendProblem, firstInvalidStep,
  firstStepWithProblem, FORM_SUBTITLE, FORM_TITLE, formatLocalPhone, formatRegNum, formatRSBSA,
  formatTIN, formFromApplication, formFromProfile, fullPhoneNumber, GOV_ID_TYPES, govIdLabel,
  INITIAL_FORM, isIndividual, isRegistered, keepOtherSteps, LEGAL_WORDS, LOCAL_PHONE_MAX,
  NAME_MAX, NAME_SUFFIXES, NO_DOCUMENTS, NO_PROOF, normalizeEmail, OPS_WORDS, payloadDocuments,
  PERSON_MAX, phoneSendProblem, pickedDocument, placeServerErrors, PREFILL_STATUSES, selfieError,
  progressText, REGISTRATION, REGISTRATION_MAX, RSBSA_MAX, SELLER_OPTIONS, SMALL_PRODUCER_HELP,
  STEPS, SUBMIT_LATER_HELP, SUBMIT_MODE_OPTIONS, submitLabel, TIN_MAX, toggleDay, VAT_OPTIONS,
  validateStep, YES_NO_OPTIONS,
  type ContactProof, type FieldErrors, type FieldKey, type OnboardingDocuments, type OnboardingForm,
  type TextKey,
} from '../lib/onboarding';
import { ContinueOnWeb } from './ApplicationScreen';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../lib/theme';

/** One choice chip (the web .dayChip and radio options), 44 points tall for a thumb. */
function Chip({ label, on, onPress, disabled, role = 'checkbox' }: {
  label: string; on: boolean; onPress: () => void; disabled?: boolean; role?: 'checkbox' | 'radio';
}) {
  return (
    <TouchableOpacity
      style={[styles.chip, on && styles.chipOn, disabled && styles.off]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={role}
      accessibilityState={{ checked: on, disabled }}
      accessibilityLabel={label}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** A field's message under the field (rule 8). */
function FieldError({ message }: { message?: string }) {
  return message ? <Text style={styles.error} accessibilityRole="alert">{message}</Text> : null;
}

/** The web RadioGroup: a legend, one option per row when `stacked`, help and the error. */
function RadioGroup<T extends string | boolean>({ legend, options, value, onChange, error, help, stacked, disabled }: {
  legend: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string;
  help?: string;
  stacked?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={styles.field} accessibilityRole="radiogroup" accessibilityLabel={legend}>
      <Text style={styles.label}>{legend}</Text>
      <View style={stacked ? styles.stack : styles.chips}>
        {options.map((o) => (
          <Chip
            key={String(o.value)}
            label={o.label}
            on={value === o.value}
            onPress={() => onChange(o.value)}
            disabled={disabled}
            role="radio"
          />
        ))}
      </View>
      {help ? <Text style={styles.hint}>{help}</Text> : null}
      <FieldError message={error} />
    </View>
  );
}

/** The web TextField: a label, an optional counter, help and the error under it. */
function TextField({ label, value, max, onChange, error, placeholder, help, counter = true, numeric, disabled }: {
  label: string;
  value: string;
  max: number;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  help?: string;
  counter?: boolean;
  numeric?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {counter ? <Text style={styles.counter}>{value.length}/{max}</Text> : null}
      </View>
      <TextInput
        style={[styles.input, error ? styles.inputBad : null]}
        value={value}
        onChangeText={onChange}
        maxLength={max}
        placeholder={placeholder}
        placeholderTextColor={Colors.textLight}
        keyboardType={numeric ? 'number-pad' : 'default'}
        editable={!disabled}
        accessibilityLabel={label}
      />
      {help ? <Text style={styles.hint}>{help}</Text> : null}
      <FieldError message={error} />
    </View>
  );
}

/** One document: pick (the web DocumentDropzone), or the picked file with a remove button. */
function DocumentField({ label, doc, error, onPick, onRemove, disabled }: {
  label: string;
  doc: OnboardingDocuments[keyof OnboardingDocuments];
  error?: string;
  onPick: () => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {doc ? (
        <View style={styles.fileCard}>
          <Ionicons
            name={doc.mimeType === 'application/pdf' ? 'document-text-outline' : 'image-outline'}
            size={24}
            color={Colors.primaryDark}
          />
          <View style={styles.flex}>
            <Text style={styles.fileName} numberOfLines={1}>{doc.name}</Text>
            <Text style={styles.fileMeta}>{documentMeta(doc)}</Text>
          </View>
          <TouchableOpacity
            onPress={onRemove}
            disabled={disabled}
            style={styles.remove}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${label}`}
          >
            <Ionicons name="close" size={20} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.dropzone, error ? styles.inputBad : null]}
          onPress={onPick}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={label}
        >
          <Ionicons name="cloud-upload-outline" size={28} color={Colors.primary} />
          <Text style={styles.dropTitle}>Choose a file</Text>
          <Text style={styles.fileMeta}>PDF · PNG · JPG · WEBP · max 10 MB</Text>
        </TouchableOpacity>
      )}
      <FieldError message={error} />
    </View>
  );
}

// Selfie with ID: the camera only (no gallery). The system camera shows its own Retake / Use
// photo step, and lets the applicant switch to the rear camera.
const SELFIE_CAMERA: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  cameraType: ImagePicker.CameraType.front,
  allowsEditing: false,
  // No resize library in the app: a lower quality keeps the photo far under the 10 MB limit.
  quality: 0.6,
  exif: false,
};

const SELFIE_TIPS = [
  'Hold your ID next to your face. Show your full face and the full card.',
  'Make sure that the text on the ID is clear and easy to read.',
  'Use good light. Do not wear a cap, mask or sunglasses.',
];

/** The selfie with ID: tips, then the camera; after the photo, a preview and Retake. */
function SelfieField({ label, doc, error, onTake, disabled }: {
  label: string;
  doc: OnboardingDocuments['selfie'];
  error?: string;
  onTake: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.hint}>
        Take a photo of yourself while you hold the ID that you uploaded. Our team compares your face with the photo
        on the ID. You cannot upload a saved photo.
      </Text>
      {SELFIE_TIPS.map((tip) => (
        <Text key={tip} style={styles.hint}>{'•'} {tip}</Text>
      ))}
      {doc ? (
        <View style={styles.selfieBox}>
          <Image source={{ uri: doc.uri }} style={styles.selfiePreview} resizeMode="contain" accessibilityLabel="Your selfie with ID" />
          <Button label="Retake" onPress={onTake} disabled={disabled} />
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.dropzone, error ? styles.inputBad : null]}
          onPress={onTake}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={label}
        >
          <Ionicons name="camera-outline" size={28} color={Colors.primary} />
          <Text style={styles.dropTitle}>Open camera</Text>
        </TouchableOpacity>
      )}
      <FieldError message={error} />
    </View>
  );
}

type Props = {
  /** 0 = operations, 1 = business information (`?step=business`). */
  initialStep?: number;
  /** The saved application after "Submit" or "Submit later". */
  onSubmitted: (application: ApiMerchantApplication) => void;
};

export default function OnboardingFormScreen({ initialStep = 0, onSubmitted }: Props) {
  const router = useRouter();
  const { token, sendPhoneCode, verifyPhone } = useAuth();
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);

  const [loading, setLoading] = useState(true);
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex] ?? STEPS[0]!;
  const [form, setForm] = useState<OnboardingForm>(INITIAL_FORM);
  const [documents, setDocuments] = useState<OnboardingDocuments>(NO_DOCUMENTS);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // Errors that belong to no field (network, server, rate limit); field errors show under each field.
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [needsAccountPhone, setNeedsAccountPhone] = useState(false);
  const [proof, setProof] = useState<ContactProof>(NO_PROOF);
  // One timer per channel: the hourly limit is per channel (web: one hook per field).
  const emailCooldown = useResendCooldown();
  const phoneCooldown = useResendCooldown();

  // The web prefill: the account's email, number and default address, then a saved
  // application (Submit later, or one sent back) on top. No prefill on error. As on the web,
  // `?step=business` opens the business step only for an application that may be sent again.
  useEffect(() => {
    let active = true;
    const prefill = async () => {
      try {
        const p = await api.users.me(token);
        if (!active) return;
        const address = p.addresses?.find((a) => a.is_default) ?? p.addresses?.[0] ?? null;
        setProof((prev) => ({
          ...prev,
          accountPhone: p.phone_verified ? p.phone_number : null,
          accountEmail: p.email_verified && p.email ? normalizeEmail(p.email) : null,
        }));
        setForm((prev) => formFromProfile(prev, { email: p.email, phone_number: p.phone_number, address }));
      } catch {
        // No prefill on error.
      }
      try {
        const application = await api.onboarding.myApplication(token);
        if (active && application && PREFILL_STATUSES.has(application.status)) {
          setForm((prev) => formFromApplication(application, prev));
          if (initialStep > 0) setStepIndex(Math.min(initialStep, STEPS.length - 1));
        }
      } catch {
        // No prefill on error.
      }
      if (active) setLoading(false);
    };
    void prefill();
    return () => { active = false; };
    // The token refreshes about every minute; the prefill runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const contact = contactState(form, proof);
  const phone = fullPhoneNumber(form.contact_number);
  const later = form.submit_mode === 'later';
  const sellerType = form.seller_type;
  const registration = sellerType ? REGISTRATION[sellerType] : undefined;

  const clearErrors = (...keys: FieldKey[]) =>
    setFieldErrors((prev) => {
      if (!keys.some((k) => k in prev)) return prev;
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });

  const showFieldErrors = (errors: FieldErrors) => {
    setFieldErrors(errors);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const setValue = <K extends keyof OnboardingForm>(key: K, value: OnboardingForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    clearErrors(key as FieldKey);
  };
  const setText = (key: TextKey) => (value: string) => setValue(key, value);

  // A new number or email is unverified again and needs a new code.
  const setPhone = (raw: string) => {
    const next = formatLocalPhone(raw);
    if (next === form.contact_number) return;
    setForm((prev) => ({ ...prev, contact_number: next }));
    setProof((prev) => ({ ...prev, phoneToken: null }));
    clearErrors('contact_number');
  };

  const setEmail = (next: string) => {
    if (normalizeEmail(next) !== normalizeEmail(form.contact_email)) {
      setProof((prev) => ({ ...prev, emailToken: null }));
    }
    setForm((prev) => ({ ...prev, contact_email: next }));
    clearErrors('contact_email');
  };

  const tapDay = (day: MerchantDay) => {
    setForm((prev) => ({ ...prev, available_days: toggleDay(prev.available_days, day) }));
    clearErrors('available_days');
  };

  // No verified account number yet: the code verifies this number on the account
  // (BetterAuth), and that also proves the contact number (web sendPhone / verifyPhone).
  const sendPhone = async () => {
    if (proof.accountPhone === null) await sendPhoneCode(phone);
    else await api.sms.send(token, phone);
  };
  const verifyPhoneCode = async (code: string) => {
    if (proof.accountPhone === null) {
      await verifyPhone(phone, code);
      setProof((prev) => ({ ...prev, accountPhone: normalizePhMobile(phone) }));
    } else {
      const phoneToken = await api.sms.verify(token, phone, code);
      setProof((prev) => ({ ...prev, phoneToken }));
    }
    clearErrors('contact_number');
  };
  const sendEmail = async () => { await api.email.send(token, form.contact_email.trim()); };
  const verifyEmail = async (code: string) => {
    const emailToken = await api.email.verify(token, form.contact_email.trim(), code);
    setProof((prev) => ({ ...prev, emailToken }));
    clearErrors('contact_email');
  };

  // The S2 type and size check runs on the pick, so a file the server would refuse is never
  // kept; the same words show again on submit for a document still missing (web documentError).
  const pickDocument = async (key: Exclude<keyof OnboardingDocuments, 'selfie'>, field: FieldKey) => {
    const result = await DocumentPicker.getDocumentAsync({
      type: [...DOCUMENT_TYPES],
      copyToCacheDirectory: true,
      multiple: false,
    });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return;
    const doc = pickedDocument(asset);
    const problem = documentError(doc, DOCUMENT_LABELS[key]);
    if (problem) {
      setFieldErrors((prev) => ({ ...prev, [field]: problem }));
      return;
    }
    setDocuments((prev) => ({ ...prev, [key]: doc }));
    clearErrors(field);
  };
  const removeDocument = (key: keyof OnboardingDocuments) =>
    setDocuments((prev) => ({ ...prev, [key]: null }));

  const takeSelfie = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setFieldErrors((prev) => ({
        ...prev,
        selfie_file: 'Camera access is blocked. Allow the camera for Carabao in your phone settings, then try again.',
      }));
      return;
    }
    const result = await ImagePicker.launchCameraAsync(SELFIE_CAMERA);
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return;
    const doc = {
      uri: asset.uri,
      name: asset.fileName?.trim() || 'selfie-with-id.jpg',
      mimeType: asset.mimeType ?? 'image/jpeg',
      size: typeof asset.fileSize === 'number' ? asset.fileSize : null,
    };
    const problem = selfieError(doc);
    if (problem) {
      setFieldErrors((prev) => ({ ...prev, selfie_file: problem }));
      return;
    }
    setDocuments((prev) => ({ ...prev, selfie: doc }));
    clearErrors('selfie_file');
  };

  const goNext = () => {
    setError(null);
    const errors = validateStep(step.id, form, proof, documents);
    if (Object.keys(errors).length) return showFieldErrors(errors);
    // Keep server errors for later steps, so they show when the user gets there.
    setFieldErrors((prev) => keepOtherSteps(prev, step.id));
    setStepIndex((s) => Math.min(s + 1, STEPS.length - 1));
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const goBack = () => {
    setError(null);
    setFieldErrors({});
    setStepIndex((s) => Math.max(s - 1, 0));
  };

  // `withProof`: the proof just after the phone sheet verified the account's number.
  const submit = async (withProof: ContactProof = proof) => {
    setError(null);
    // Take the user to the first step with problems and mark each field there.
    const invalid = firstInvalidStep(form, withProof, documents);
    if (invalid) {
      setStepIndex(invalid.index);
      return showFieldErrors(invalid.errors);
    }
    const payload = buildPayload(form, withProof);
    if (!payload) return;
    setSubmitting(true);
    try {
      const application = await api.onboarding.submit(token, payload, payloadDocuments(form, documents));
      onSubmitted(application);
    } catch (err: unknown) {
      if (isPhoneVerificationRequired(err)) {
        setNeedsAccountPhone(true);
        return;
      }
      // The backend names the fields it refused: show them under those fields. A key with no
      // field on the form (e.g. "payload") goes to the top instead.
      const { shown, unplaced } = placeServerErrors(err instanceof ApiError ? err.fieldErrors : {});
      const fields = Object.keys(shown);
      if (unplaced.length) setError(unplaced.join(' '));
      if (fields.length) {
        // The earliest step with a problem; later steps keep theirs (goNext).
        const target = firstStepWithProblem(fields);
        if (target !== -1) setStepIndex(target);
        showFieldErrors(shown);
      }
      if (fields.length || unplaced.length) return;
      // A 429 (onboarding_submit, 10 per hour), a 409 or a 413: the server's own words.
      setError(err instanceof Error && err.message ? err.message : LEGAL_WORDS.submitFailed);
      scrollRef.current?.scrollToEnd({ animated: true });
    } finally {
      setSubmitting(false);
    }
  };

  // The sheet saved a verified number on the account: read it back, then send again.
  const onPhoneVerified = async () => {
    setNeedsAccountPhone(false);
    let next = proof;
    try {
      const p = await api.users.me(token);
      next = { ...proof, accountPhone: p.phone_verified ? p.phone_number : proof.accountPhone };
      setProof(next);
    } catch {
      // Send with what the form has; the server says again if the number is still missing.
    }
    void submit(next);
  };

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const openWeb = (page: 'terms' | 'privacy') => {
    void WebBrowser.openBrowserAsync(webPageUrl(WEB_BASE, page));
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const personFields = (prefix: '' | 'rep_') => {
    const key = <K extends 'last_name' | 'first_name' | 'middle_name'>(k: K) => `${prefix}${k}` as TextKey;
    const suffixKey = `${prefix}suffix` as 'suffix' | 'rep_suffix';
    return (
      <>
        <TextField label={LEGAL_WORDS.lastName} value={form[key('last_name')]} max={PERSON_MAX}
          onChange={setText(key('last_name'))} error={fieldErrors[key('last_name')]} placeholder="Dela Cruz"
          disabled={submitting} />
        <TextField label={LEGAL_WORDS.firstName} value={form[key('first_name')]} max={PERSON_MAX}
          onChange={setText(key('first_name'))} error={fieldErrors[key('first_name')]} placeholder="Juan"
          disabled={submitting} />
        <TextField label={LEGAL_WORDS.middleName} value={form[key('middle_name')]} max={PERSON_MAX}
          onChange={setText(key('middle_name'))} error={fieldErrors[key('middle_name')]} placeholder="Santos"
          disabled={submitting} />
        <RadioGroup<string>
          legend={LEGAL_WORDS.suffix}
          options={[{ value: '', label: LEGAL_WORDS.suffixNone }, ...NAME_SUFFIXES.map((s) => ({ value: s, label: s }))]}
          value={form[suffixKey]}
          onChange={(v) => setValue(suffixKey, v as OnboardingForm['suffix'])}
          error={fieldErrors[suffixKey]}
          disabled={submitting}
        />
        <Text style={styles.hint}>{LEGAL_WORDS.nameHelp}</Text>
      </>
    );
  };

  const legalStep = (
    <View style={styles.card}>
      <RadioGroup
        legend={LEGAL_WORDS.submitMode}
        options={SUBMIT_MODE_OPTIONS}
        value={form.submit_mode}
        onChange={(v) => setValue('submit_mode', v)}
        error={fieldErrors.submit_mode}
        help={SUBMIT_LATER_HELP}
        disabled={submitting}
      />
      <RadioGroup
        legend={LEGAL_WORDS.sellerType}
        options={SELLER_OPTIONS}
        value={sellerType}
        onChange={(v) => setValue('seller_type', v)}
        error={fieldErrors.seller_type}
        stacked
        disabled={submitting}
      />

      {!later && sellerType ? (
        <>
          <Text style={styles.section}>{LEGAL_WORDS.legalName}</Text>
          {isIndividual(sellerType) ? personFields('') : null}

          {sellerType === 'corporation' || sellerType === 'cooperative' ? (
            <TextField
              label={sellerType === 'cooperative' ? LEGAL_WORDS.coopName : LEGAL_WORDS.companyName}
              value={form.company_name}
              max={COMPANY_MAX}
              onChange={setText('company_name')}
              error={fieldErrors.company_name}
              placeholder={sellerType === 'cooperative' ? LEGAL_WORDS.coopPlaceholder : LEGAL_WORDS.companyPlaceholder}
              disabled={submitting}
            />
          ) : null}
          {sellerType !== 'individual_farmer' ? (
            <TextField
              label={sellerType === 'cooperative' ? LEGAL_WORDS.tradeNameOptional : LEGAL_WORDS.tradeName}
              value={form.trade_name}
              max={COMPANY_MAX}
              onChange={setText('trade_name')}
              error={fieldErrors.trade_name}
              placeholder={LEGAL_WORDS.tradeNamePlaceholder}
              disabled={submitting}
            />
          ) : null}
          {sellerType === 'corporation' ? (
            <>
              <Text style={styles.section}>{LEGAL_WORDS.representative}</Text>
              {personFields('rep_')}
            </>
          ) : null}

          {registration ? (
            <TextField
              label={`${registration.agency} registration number`}
              value={form.registration_number}
              max={REGISTRATION_MAX}
              counter={false}
              onChange={(v) => setValue('registration_number', formatRegNum(v))}
              error={fieldErrors.registration_number}
              placeholder={registration.placeholder}
              help={registration.hint}
              disabled={submitting}
            />
          ) : null}

          <Text style={styles.section}>{LEGAL_WORDS.taxInformation}</Text>
          <TextField
            label={isRegistered(sellerType) ? LEGAL_WORDS.tin : LEGAL_WORDS.tinOptional}
            value={form.tin}
            max={TIN_MAX}
            counter={false}
            numeric
            onChange={(v) => setValue('tin', formatTIN(v))}
            error={fieldErrors.tin}
            placeholder={LEGAL_WORDS.tinPlaceholder}
            help={isRegistered(sellerType) ? LEGAL_WORDS.tinHelpRegistered : LEGAL_WORDS.tinHelpOptional}
            disabled={submitting}
          />
          {isRegistered(sellerType) ? (
            <>
              <RadioGroup
                legend={LEGAL_WORDS.vatStatus}
                options={VAT_OPTIONS}
                value={form.vat_status}
                onChange={(v) => setValue('vat_status', v)}
                error={fieldErrors.vat_status}
                disabled={submitting}
              />
              <DocumentField
                label={LEGAL_WORDS.birCert}
                doc={documents.birCert}
                error={fieldErrors.bir_cert_file}
                onPick={() => void pickDocument('birCert', 'bir_cert_file')}
                onRemove={() => removeDocument('birCert')}
                disabled={submitting}
              />
            </>
          ) : null}
          {isIndividual(sellerType) ? (
            <RadioGroup
              legend={LEGAL_WORDS.smallProducer}
              options={YES_NO_OPTIONS}
              value={form.small_agri_producer}
              onChange={(v) => setValue('small_agri_producer', v)}
              error={fieldErrors.small_agri_producer}
              help={SMALL_PRODUCER_HELP}
              disabled={submitting}
            />
          ) : null}

          <Text style={styles.section}>{LEGAL_WORDS.documents}</Text>
          <Text style={styles.hint}>{documentsIntro(sellerType)}</Text>
          <View style={styles.field}>
            <Text style={styles.label}>{LEGAL_WORDS.rsbsaNumber}</Text>
            <TextInput
              style={[styles.input, fieldErrors.rsbsa_number ? styles.inputBad : null]}
              value={form.rsbsa_number}
              onChangeText={(v) => setValue('rsbsa_number', formatRSBSA(v))}
              placeholder={LEGAL_WORDS.rsbsaPlaceholder}
              placeholderTextColor={Colors.textLight}
              autoCapitalize="characters"
              maxLength={RSBSA_MAX}
              editable={!submitting}
              accessibilityLabel={LEGAL_WORDS.rsbsaNumber}
            />
            <FieldError message={fieldErrors.rsbsa_number} />
          </View>
          <RadioGroup
            legend={`${govIdLabel(sellerType)} type`}
            options={GOV_ID_TYPES.map((t) => ({ value: t, label: t }))}
            value={form.gov_id_type}
            onChange={(v) => setValue('gov_id_type', v)}
            error={fieldErrors.gov_id_type}
            disabled={submitting}
          />
          <DocumentField
            label={LEGAL_WORDS.rsbsaFile}
            doc={documents.rsbsa}
            error={fieldErrors.rsbsa_file}
            onPick={() => void pickDocument('rsbsa', 'rsbsa_file')}
            onRemove={() => removeDocument('rsbsa')}
            disabled={submitting}
          />
          <DocumentField
            label={`${govIdLabel(sellerType)} (photo or PDF)`}
            doc={documents.govId}
            error={fieldErrors.gov_id_file}
            onPick={() => void pickDocument('govId', 'gov_id_file')}
            onRemove={() => removeDocument('govId')}
            disabled={submitting}
          />
          <SelfieField
            label={sellerType === 'corporation'
              ? 'Selfie of the authorized representative with their government ID'
              : 'Selfie with your government ID'}
            doc={documents.selfie}
            error={fieldErrors.selfie_file}
            onTake={() => void takeSelfie()}
            disabled={submitting}
          />

          <View style={styles.field}>
            <TouchableOpacity
              style={styles.checkRow}
              onPress={() => setValue('terms_accepted', !form.terms_accepted)}
              disabled={submitting}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: form.terms_accepted }}
              accessibilityLabel="I agree to the Terms of Service and the Data Privacy Policy."
            >
              <Ionicons
                name={form.terms_accepted ? 'checkbox' : 'square-outline'}
                size={24}
                color={fieldErrors.terms_accepted ? Colors.error : Colors.primary}
              />
              <Text style={[styles.flex, styles.checkText]}>
                I agree to the{' '}
                <Text style={styles.link} onPress={() => openWeb('terms')}>Terms of Service</Text>
                {' '}and the{' '}
                <Text style={styles.link} onPress={() => openWeb('privacy')}>Data Privacy Policy</Text>.
              </Text>
            </TouchableOpacity>
            <FieldError message={fieldErrors.terms_accepted} />
          </View>
        </>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={leave} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{FORM_TITLE}</Text>
        <Text style={styles.pill}>{progressText(stepIndex)}</Text>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.subtitle}>{FORM_SUBTITLE}</Text>

          <View style={styles.stepper} accessibilityLabel="Onboarding steps">
            {STEPS.map((s, idx) => {
              const state = idx === stepIndex ? 'active' : idx < stepIndex ? 'done' : 'todo';
              return (
                <View key={s.id} style={styles.step}>
                  <View style={[styles.dot, state !== 'todo' && styles.dotOn]} />
                  <View style={styles.flex}>
                    <Text style={[styles.stepTitle, state === 'todo' && styles.muted]}>{s.title}</Text>
                    <Text style={styles.stepSubtitle}>{s.subtitle}</Text>
                  </View>
                </View>
              );
            })}
          </View>

          {step.id === 'ops' ? (
            <View style={styles.card}>
              <TextField
                label={OPS_WORDS.merchantName}
                value={form.merchant_name}
                max={NAME_MAX}
                onChange={setText('merchant_name')}
                error={fieldErrors.merchant_name}
                placeholder={OPS_WORDS.merchantNamePlaceholder}
                help={OPS_WORDS.merchantNameHelp}
                disabled={submitting}
              />

              <AddressForm
                value={form.location}
                onChange={(location) => {
                  setForm((prev) => ({ ...prev, location }));
                  clearErrors('region', 'province', 'city', 'barangay', 'postal_code', 'address');
                  if (location.pin_confirmed) clearErrors('pin');
                }}
                errors={addressErrorsOf(fieldErrors)}
                token={token}
              />

              <View style={styles.field}>
                <Text style={styles.label}>{OPS_WORDS.availableDays}</Text>
                <View style={styles.chips} accessibilityLabel={OPS_WORDS.availableDays}>
                  {DAYS.map((d) => (
                    <Chip key={d} label={d} on={form.available_days.includes(d)} onPress={() => tapDay(d)} />
                  ))}
                </View>
                <FieldError message={fieldErrors.available_days} />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{OPS_WORDS.contactEmail}</Text>
                <TextInput
                  style={[styles.input, fieldErrors.contact_email ? styles.inputBad : null]}
                  value={form.contact_email}
                  onChangeText={setEmail}
                  placeholder={OPS_WORDS.contactEmailPlaceholder}
                  placeholderTextColor={Colors.textLight}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  editable={!submitting}
                  accessibilityLabel={OPS_WORDS.contactEmail}
                />
                <FieldError message={fieldErrors.contact_email} />
                <ContactCodeField
                  key={normalizeEmail(form.contact_email)}
                  channel="email"
                  value={normalizeEmail(form.contact_email)}
                  verified={contact.emailVerified}
                  accountNote={contact.isAccountEmail ? CONTACT_WORDS.accountEmail : undefined}
                  disabled={submitting}
                  validate={() => emailSendProblem(form.contact_email)}
                  onSend={sendEmail}
                  onVerify={verifyEmail}
                  cooldown={emailCooldown}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{OPS_WORDS.contactNumber}</Text>
                <View style={styles.phoneRow}>
                  <Text style={styles.prefix}>+63</Text>
                  <TextInput
                    style={[styles.input, styles.flex, fieldErrors.contact_number ? styles.inputBad : null]}
                    value={form.contact_number}
                    onChangeText={setPhone}
                    placeholder={OPS_WORDS.contactNumberPlaceholder}
                    placeholderTextColor={Colors.textLight}
                    keyboardType="number-pad"
                    maxLength={LOCAL_PHONE_MAX}
                    editable={!submitting}
                    accessibilityLabel={OPS_WORDS.contactNumber}
                  />
                </View>
                <FieldError message={fieldErrors.contact_number} />
                <ContactCodeField
                  key={form.contact_number}
                  channel="number"
                  value={form.contact_number}
                  verified={contact.phoneVerified}
                  accountNote={contact.isAccountPhone ? CONTACT_WORDS.accountPhone : undefined}
                  disabled={submitting}
                  validate={() => phoneSendProblem(form.contact_number)}
                  onSend={sendPhone}
                  onVerify={verifyPhoneCode}
                  cooldown={phoneCooldown}
                />
              </View>
            </View>
          ) : legalStep}

          {error ? <Text style={styles.banner} accessibilityRole="alert">{error}</Text> : null}

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.secondary, (stepIndex === 0 || submitting) && styles.off]}
              onPress={goBack}
              disabled={stepIndex === 0 || submitting}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryText}>{OPS_WORDS.back}</Text>
            </TouchableOpacity>
            {stepIndex < STEPS.length - 1 ? (
              <Button label={OPS_WORDS.continue} onPress={goNext} style={styles.flex} disabled={submitting} />
            ) : (
              <Button
                label={submitLabel(submitting, later)}
                onPress={() => void submit()}
                loading={submitting}
                disabled={submitting}
                style={styles.flex}
              />
            )}
          </View>

          <ContinueOnWeb />
        </ScrollView>
      </KeyboardAvoidingView>

      <PhoneVerifySheet
        visible={needsAccountPhone}
        reason={LEGAL_WORDS.phoneReason}
        onClose={() => setNeedsAccountPhone(false)}
        onVerified={() => void onPhoneVerified()}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.offWhite },
  flex: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl * 2 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm, backgroundColor: Colors.white,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  pill: {
    fontSize: FontSize.xs, fontWeight: '700', color: Colors.primaryDark, backgroundColor: Colors.primaryLight,
    paddingHorizontal: Spacing.md, paddingVertical: 4, borderRadius: Radius.full, overflow: 'hidden',
  },
  subtitle: { fontSize: FontSize.sm, color: Colors.textMuted, lineHeight: 20, marginBottom: Spacing.md },

  stepper: { gap: Spacing.sm, marginBottom: Spacing.md },
  step: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 4, backgroundColor: Colors.border },
  dotOn: { backgroundColor: Colors.primary },
  stepTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  stepSubtitle: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2, lineHeight: 16 },
  muted: { color: Colors.textMuted },

  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, ...Shadow.sm },
  section: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text, marginTop: Spacing.lg },
  field: { marginTop: Spacing.md },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600', marginBottom: 6 },
  counter: { fontSize: FontSize.xs, color: Colors.textLight },
  input: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 11, fontSize: FontSize.md,
    color: Colors.text, backgroundColor: Colors.white,
  },
  inputBad: { borderColor: Colors.error },
  hint: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 6, lineHeight: 16 },
  error: { color: Colors.error, fontSize: FontSize.xs, marginTop: 4 },
  banner: {
    marginTop: Spacing.md, padding: Spacing.md, borderRadius: Radius.md, overflow: 'hidden',
    backgroundColor: '#FDECEA', color: Colors.error, fontSize: FontSize.sm, lineHeight: 20,
  },

  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  prefix: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textMuted },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  stack: { gap: Spacing.sm },
  chip: {
    minWidth: 56, minHeight: 44, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: Spacing.md, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  chipOn: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  chipText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textMuted, textAlign: 'center' },
  chipTextOn: { color: Colors.primaryDark, fontWeight: '700' },

  dropzone: {
    minHeight: 96, alignItems: 'center', justifyContent: 'center', gap: 4, padding: Spacing.md,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.border, borderRadius: Radius.md,
  },
  dropTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  fileCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md,
    borderWidth: 1.5, borderColor: Colors.primary, borderRadius: Radius.md, backgroundColor: Colors.primaryLight,
  },
  fileName: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  fileMeta: { fontSize: FontSize.xs, color: Colors.textMuted },
  remove: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  selfieBox: { gap: Spacing.sm },
  selfiePreview: { width: '100%', aspectRatio: 3 / 4, borderRadius: Radius.md, backgroundColor: Colors.text },

  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, minHeight: 44 },
  checkText: { fontSize: FontSize.sm, color: Colors.text, lineHeight: 22 },
  link: { color: Colors.primaryDark, fontWeight: '700', textDecorationLine: 'underline' },

  footer: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg, alignItems: 'center' },
  secondary: {
    minHeight: 48, minWidth: 96, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: Spacing.lg, borderRadius: Radius.md, backgroundColor: Colors.borderLight,
  },
  secondaryText: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  off: { opacity: 0.5 },
});
