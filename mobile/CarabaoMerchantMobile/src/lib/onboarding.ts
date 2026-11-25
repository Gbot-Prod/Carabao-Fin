// src/lib/onboarding.ts
// S17 (plan §5.12): the rules of the web merchant application
// (frontend/carabao-app/app/(site)/(merchant)/merchant/onboarding/page.tsx and
// ContactCodeField.tsx), DOM-free, so `node --test` can check them. The web is the spec: the
// steps, the seller types, the limits and every message are copied word for word
// (inStep.test.ts reads the web and backend files). src/screens/OnboardingFormScreen.tsx holds
// the state and the calls.
//
// The two steps are the web's: "ops" (where the farm operates, a verified email and number)
// and "legal" (submit now or later, seller type, names, tax and documents). As on the web, the
// seller type is asked on the legal step; "Submit later" sends step 1 and the seller type only.
import type { ApiMerchantApplication } from './api.ts';
import { normalizePhMobile } from './phone.ts';
import {
  addressPayload,
  checkAddress,
  EMPTY_ADDRESS,
  type AddressErrors,
  type AddressValue,
} from './pinLocation.ts';
import { DAYS, formatLocalPhone, type MerchantDay } from './storeSettings.ts';
import { checkDocument, DOCUMENT_MAX_BYTES, IMAGE_TYPES, type FileInfo } from './uploads.ts';

// ── Steps ─────────────────────────────────────────────────────────────────────

export type StepId = 'ops' | 'legal';

export const STEPS: { id: StepId; title: string; subtitle: string }[] = [
  { id: 'ops', title: 'Operations & Contact', subtitle: 'Where you operate, and a verified email and number.' },
  { id: 'legal', title: 'Business Information', subtitle: 'Who is selling, tax details and documents: now or later.' },
];

/** The web header pill: "1 / 2". */
export const progressText = (stepIndex: number): string => `${stepIndex + 1} / ${STEPS.length}`;

export const FORM_TITLE = 'Apply as a Merchant';
export const FORM_SUBTITLE = 'A short onboarding to verify your contact details and documents.';

// ── Choices (backend schemas/merchant_application.py, web util/api/merchants.ts) ─

export const SELLER_TYPES = ['individual_farmer', 'sole_proprietor', 'corporation', 'cooperative'] as const;
export type SellerType = (typeof SELLER_TYPES)[number];
export type SubmitMode = 'now' | 'later';
export type VatStatus = 'vat_registered' | 'non_vat';
export const NAME_SUFFIXES = ['Jr.', 'Sr.', 'II', 'III', 'IV', 'V'] as const;
export type NameSuffix = (typeof NAME_SUFFIXES)[number];
/** As on the government ID (individual seller types). */
export type Sex = 'male' | 'female';
export const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];
export const MIN_SELLER_AGE = 18;
/** Valid government IDs (backend GovIdType). RSBSA is a separate upload. */
export const GOV_ID_TYPES = [
  'PhilSys National ID',
  'Passport',
  "Driver's License",
  'UMID',
  'SSS',
  'PRC',
  'Postal ID',
  "Voter's ID",
  'PhilHealth',
  'Senior Citizen ID',
  'PWD ID',
] as const;
export type GovIdType = (typeof GOV_ID_TYPES)[number];

/** The radio labels of the web form (longer than the admin SELLER_TYPE_LABELS). */
export const SELLER_OPTIONS: { value: SellerType; label: string }[] = [
  { value: 'individual_farmer', label: 'Individual farmer (not business-registered)' },
  { value: 'sole_proprietor', label: 'Sole proprietorship' },
  { value: 'corporation', label: 'Corporation / Partnership / One Person Corporation' },
  { value: 'cooperative', label: 'Cooperative' },
];

export const SUBMIT_MODE_OPTIONS: { value: SubmitMode; label: string }[] = [
  { value: 'now', label: 'Submit now' },
  { value: 'later', label: 'Submit later' },
];

/** The agency each registered seller type implies (backend REGISTRATION_FOR_SELLER). */
export const REGISTRATION: Partial<Record<SellerType, { agency: string; placeholder: string; hint: string }>> = {
  sole_proprietor: {
    agency: 'DTI',
    placeholder: 'e.g. 3456789',
    hint: 'The number on your DTI Certificate of Business Name Registration.',
  },
  corporation: {
    agency: 'SEC',
    placeholder: 'e.g. CS201912345',
    hint: 'The SEC registration number on your Certificate of Incorporation or Registration.',
  },
  cooperative: {
    agency: 'CDA',
    placeholder: 'e.g. 9520-12345678',
    hint: 'The registration number on your CDA Certificate of Registration.',
  },
};

export const isRegistered = (type: SellerType | null): boolean => type !== null && type !== 'individual_farmer';
export const isIndividual = (type: SellerType | null): boolean =>
  type === 'individual_farmer' || type === 'sole_proprietor';

export const SMALL_PRODUCER_HELP =
  'Choose Yes if you sell agricultural food products you produce and your total yearly gross sales are ' +
  '₱1,000,000 or less. Under BIR RR No. 12-2023 you don\'t need to issue invoices for those sales, but you ' +
  'must keep a simplified sales book. Business buyers don\'t withhold tax on their first ₱300,000 of ' +
  'purchases from you each year.';
export const SUBMIT_LATER_HELP =
  'You can submit your business information later if you don\'t have your documents yet, but you can\'t ' +
  'start selling until you do.';

/** The Terms version the web sends (components/TermsModal/TermsOfServiceContent.tsx TERMS_EFFECTIVE_DATE). */
export const TERMS_VERSION = 'May 21, 2026';

// ── Limits (backend MERCHANT_NAME_MAX, PERSON_NAME_MAX, COMPANY_NAME_MAX; web maxLength) ─

export const NAME_MAX = 50;
export const NAME_MIN = 3;
export const PERSON_MAX = 80;
export const COMPANY_MAX = 255;
export const REGISTRATION_MAX = 30;
export const TIN_MAX = 18;
export const RSBSA_MAX = 24;
/** "912 345 6789": ten digits and two spaces. */
export const LOCAL_PHONE_MAX = 12;

// ── Formats (web page.tsx) ────────────────────────────────────────────────────

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** 9 digits plus a 3-5 digit branch code (backend normalize_tin). */
export const TIN_DIGITS = /^\d{12,14}$/;

/** 999-999-999-000, with a branch code of up to 5 digits. */
export function formatTIN(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 14);
  const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9), digits.slice(9)];
  return parts.filter(Boolean).join('-');
}

export function formatRegNum(raw: string): string {
  return raw.replace(/[^A-Za-z0-9-]/g, '').toUpperCase().slice(0, REGISTRATION_MAX);
}

export function formatRSBSA(raw: string): string {
  if (!raw) return '';
  const stripped = raw.toUpperCase().replace(/^RSBSA-?/, '').replace(/[^A-Z0-9]/g, '').slice(0, 16);
  if (!stripped) return '';
  const parts: string[] = [];
  for (let i = 0; i < stripped.length; i += 4) parts.push(stripped.slice(i, i + 4));
  return `RSBSA-${parts.join('-')}`;
}

export { formatLocalPhone };

export const normalizeEmail = (value: string): string => value.trim().toLowerCase();

/** The local box "912 345 6789" as the number the codes go to: "+639123456789" (spaces dropped). */
export const fullPhoneNumber = (local: string): string => `+63${local.replace(/\s/g, '')}`;

// ── Form state ────────────────────────────────────────────────────────────────

/** A picked document (expo-document-picker): what the checks and the upload need. */
export type OnboardingDocument = { uri: string; name: string; mimeType: string | null; size: number | null };

export type OnboardingDocuments = {
  rsbsa: OnboardingDocument | null;
  govId: OnboardingDocument | null;
  birCert: OnboardingDocument | null;
  /** Selfie with ID: a camera photo only (expo-image-picker launchCameraAsync). */
  selfie: OnboardingDocument | null;
};

export const NO_DOCUMENTS: OnboardingDocuments = { rsbsa: null, govId: null, birCert: null, selfie: null };

/**
 * Everything the form holds (the web FormState). The address part is the AddressValue that
 * src/components/AddressForm.tsx edits; its `street` is the payload's `address`.
 */
export type OnboardingForm = {
  location: AddressValue;
  available_days: MerchantDay[];
  contact_email: string;
  /** The local box, "912 345 6789"; +63 is shown in front of it. */
  contact_number: string;
  submit_mode: SubmitMode | null;
  seller_type: SellerType | null;
  merchant_name: string;
  last_name: string;
  first_name: string;
  middle_name: string;
  suffix: NameSuffix | '';
  sex: Sex | '';
  /** YYYY-MM-DD. */
  birth_date: string;
  rep_last_name: string;
  rep_first_name: string;
  rep_middle_name: string;
  rep_suffix: NameSuffix | '';
  company_name: string;
  trade_name: string;
  registration_number: string;
  tin: string;
  vat_status: VatStatus | null;
  small_agri_producer: boolean | null;
  rsbsa_number: string;
  gov_id_type: GovIdType;
  terms_accepted: boolean;
};

export type TextKey = {
  [K in keyof OnboardingForm]-?: OnboardingForm[K] extends string ? K : never;
}[keyof OnboardingForm];

/** Form fields plus the parts of the form that are not payload fields (the web FieldKey). */
export type FieldKey =
  | Exclude<keyof OnboardingForm, 'location'>
  | keyof AddressErrors
  | 'rsbsa_file'
  | 'gov_id_file'
  | 'bir_cert_file'
  | 'selfie_file';
export type FieldErrors = Partial<Record<FieldKey, string>>;

export const INITIAL_FORM: OnboardingForm = {
  location: EMPTY_ADDRESS,
  available_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  contact_email: '',
  contact_number: '',
  submit_mode: null,
  seller_type: null,
  merchant_name: '',
  last_name: '',
  first_name: '',
  middle_name: '',
  suffix: '',
  sex: '',
  birth_date: '',
  rep_last_name: '',
  rep_first_name: '',
  rep_middle_name: '',
  rep_suffix: '',
  company_name: '',
  trade_name: '',
  registration_number: '',
  tin: '',
  vat_status: null,
  small_agri_producer: null,
  rsbsa_number: '',
  gov_id_type: 'PhilSys National ID',
  terms_accepted: false,
};

/** Days in week order, as the web sorts them before it sends. */
export const sortDays = (days: readonly string[]): MerchantDay[] =>
  DAYS.filter((d) => days.includes(d));

/** A day chip tap: on becomes off, off becomes on; the week order stays. */
export function toggleDay(days: readonly MerchantDay[], day: MerchantDay): MerchantDay[] {
  return days.includes(day) ? days.filter((d) => d !== day) : sortDays([...days, day]);
}

// ── Contact proof ─────────────────────────────────────────────────────────────

/** Who the account already is, and the codes entered on this form. */
export type ContactProof = {
  /** The account's verified number ("+639…"), or null: then the code verifies it on the account. */
  accountPhone: string | null;
  /** The account's verified email (lower case), or null. */
  accountEmail: string | null;
  /** Tokens from /sms/otp/verify and /email/otp/verify. A changed value clears its token. */
  phoneToken: string | null;
  emailToken: string | null;
};

export const NO_PROOF: ContactProof = { accountPhone: null, accountEmail: null, phoneToken: null, emailToken: null };

/** The account's own verified number and email need no second code (web page.tsx). */
export function contactState(form: Pick<OnboardingForm, 'contact_email' | 'contact_number'>, proof: ContactProof) {
  const isAccountPhone = proof.accountPhone !== null
    && normalizePhMobile(fullPhoneNumber(form.contact_number)) === proof.accountPhone;
  const isAccountEmail = proof.accountEmail !== null && normalizeEmail(form.contact_email) === proof.accountEmail;
  return {
    isAccountPhone,
    isAccountEmail,
    phoneVerified: isAccountPhone || proof.phoneToken !== null,
    emailVerified: isAccountEmail || proof.emailToken !== null,
  };
}

/** The ContactCodeField words (web onboarding/ContactCodeField.tsx and page.tsx). */
export const CONTACT_WORDS = {
  sendCode: 'Send verification code',
  sending: 'Sending…',
  verify: 'Verify',
  verifying: 'Verifying…',
  resend: 'Resend',
  resendIn: (countdown: string) => `Resend in ${countdown}`,
  hint: (channel: string) => `Enter the 6-digit code sent to your ${channel}.`,
  codeLabel: (channel: string) => `6-digit code sent to your ${channel}`,
  verified: (channel: string) => `Your ${channel} is verified.`,
  sendError: 'Failed to send the code. Please try again.',
  verifyError: 'Incorrect code. Please try again.',
  accountEmail: "This is your account's verified email, so there's no code to enter.",
  accountPhone: "This is your account's verified number, so there's no code to enter.",
} as const;

export const EMAIL_SEND_PROBLEM = 'Enter a valid email, e.g. you@farm.com.';
export const PHONE_SEND_PROBLEM = 'Enter a Philippine mobile number, e.g. 912 345 6789.';

/** The check before a code goes to the email (web validateEmail). */
export const emailSendProblem = (email: string): string | null =>
  EMAIL_PATTERN.test(email.trim()) ? null : EMAIL_SEND_PROBLEM;

/** The check before a code goes to the number (web validatePhone). */
export const phoneSendProblem = (local: string): string | null =>
  normalizePhMobile(fullPhoneNumber(local)) ? null : PHONE_SEND_PROBLEM;

/** The 6-digit code box keeps digits only (web ContactCodeField). */
export const codeDigits = (raw: string): string => raw.replace(/\D/g, '').slice(0, 6);

// ── Validation (web validateStep, message for message) ────────────────────────

/** Digits typed into the birth date field as YYYY-MM-DD (the dashes are added). */
export function formatBirthDate(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  return [d.slice(0, 4), d.slice(4, 6), d.slice(6, 8)].filter(Boolean).join('-');
}

/** The same rule as the server (schemas/merchant_application.py _Person). */
export function birthDateError(value: string, today: Date = new Date()): string | null {
  if (!value) return MESSAGES.birthDateRequired;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const born = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  if (!m || !born || born.getMonth() !== Number(m[2]) - 1 || born.getDate() !== Number(m[3]))
    return MESSAGES.birthDateFormat;
  let age = today.getFullYear() - born.getFullYear();
  if (today.getMonth() < born.getMonth() || (today.getMonth() === born.getMonth() && today.getDate() < born.getDate()))
    age -= 1;
  if (age < MIN_SELLER_AGE) return MESSAGES.birthDateMinor;
  if (age > 120) return MESSAGES.birthDateFormat;
  return null;
}

export const MESSAGES = {
  merchantNameRequired: 'Merchant name is required.',
  merchantNameShort: 'Merchant name must be at least 3 characters.',
  daysRequired: 'Select at least one available day.',
  emailRequired: 'Contact email is required.',
  emailUnverified: 'Verify your contact email first.',
  phoneUnverified: 'Verify your contact number first.',
  submitMode: 'Choose Submit now or Submit later.',
  sellerType: 'Select your seller type.',
  lastName: 'Last name is required.',
  firstName: 'First name is required.',
  sexRequired: 'Sex is required.',
  birthDateRequired: 'Birth date is required.',
  birthDateFormat: 'Enter the birth date on your government ID.',
  birthDateMinor: `You must be at least ${MIN_SELLER_AGE} years old.`,
  smallProducer: 'Choose Yes or No for the small agricultural producer declaration.',
  tradeName: 'Business / trade name is required.',
  companyName: 'Company registered name is required.',
  repLastName: "Representative's last name is required.",
  repFirstName: "Representative's first name is required.",
  coopName: 'Cooperative registered name is required.',
  registration: (agency: string) => `${agency} number is required.`,
  tinRequired: 'TIN is required.',
  tinFormat: 'Enter the 9-digit TIN plus the 3-5 digit branch code, e.g. 123-456-789-000.',
  vatStatus: 'Choose your VAT registration status.',
  terms: 'Accept the Terms of Service and Data Privacy Policy to submit.',
} as const;

/** The document labels the messages name (web documentError calls). */
export const DOCUMENT_LABELS = {
  rsbsa: 'RSBSA document',
  govId: 'government ID',
  birCert: 'BIR Certificate of Registration (Form 2303)',
} as const;

/** The web documentError: a missing file, then the S2 type and size check (checkDocument). */
export function documentError(file: OnboardingDocument | null, label: string): string | null {
  if (!file) return `Please upload your ${label} (photo or PDF).`;
  const info: FileInfo = { size: file.size, mimeType: file.mimeType };
  return checkDocument(label, info);
}

/**
 * The web selfieError, then the backend check_selfie_upload rules: an image (the camera gives
 * a JPEG) of 10 MB or less.
 */
export function selfieError(file: OnboardingDocument | null): string | null {
  if (!file) return 'Take a selfie while you hold your government ID.';
  if (!file.mimeType || !IMAGE_TYPES.includes(file.mimeType)) return 'The selfie must be a photo (JPG).';
  if (file.size != null && file.size > DOCUMENT_MAX_BYTES) return 'The selfie must be 10MB or smaller. Take it again.';
  return null;
}

/** Every problem in a step, keyed by field. Mirrors the backend payload models. */
export function validateStep(
  id: StepId,
  form: OnboardingForm,
  proof: ContactProof,
  documents: OnboardingDocuments = NO_DOCUMENTS,
): FieldErrors {
  const errors: FieldErrors = {};
  if (id === 'ops') {
    const merchantName = form.merchant_name.trim();
    if (!merchantName) errors.merchant_name = MESSAGES.merchantNameRequired;
    else if (merchantName.length < NAME_MIN) errors.merchant_name = MESSAGES.merchantNameShort;
    // The address and the pin: the same words and order as the web (src/lib/pinLocation.ts).
    Object.assign(errors, checkAddress(form.location));
    if (form.available_days.length === 0) errors.available_days = MESSAGES.daysRequired;
    const contact = contactState(form, proof);
    if (!form.contact_email.trim()) errors.contact_email = MESSAGES.emailRequired;
    else if (!contact.emailVerified) errors.contact_email = MESSAGES.emailUnverified;
    if (!contact.phoneVerified) errors.contact_number = MESSAGES.phoneUnverified;
    return errors;
  }

  const sellerType = form.seller_type;
  if (!form.submit_mode) errors.submit_mode = MESSAGES.submitMode;
  if (!sellerType) errors.seller_type = MESSAGES.sellerType;
  if (form.submit_mode === 'later' || !sellerType) return errors;

  const required = (key: TextKey, message: string) => {
    if (!form[key].trim()) errors[key] = message;
  };
  if (isIndividual(sellerType)) {
    required('last_name', MESSAGES.lastName);
    required('first_name', MESSAGES.firstName);
    if (!form.sex) errors.sex = MESSAGES.sexRequired;
    const birthError = birthDateError(form.birth_date);
    if (birthError) errors.birth_date = birthError;
    if (form.small_agri_producer === null) errors.small_agri_producer = MESSAGES.smallProducer;
  }
  if (sellerType === 'sole_proprietor') required('trade_name', MESSAGES.tradeName);
  if (sellerType === 'corporation') {
    required('company_name', MESSAGES.companyName);
    required('trade_name', MESSAGES.tradeName);
    required('rep_last_name', MESSAGES.repLastName);
    required('rep_first_name', MESSAGES.repFirstName);
  }
  if (sellerType === 'cooperative') required('company_name', MESSAGES.coopName);

  const tinDigits = form.tin.replace(/\D/g, '');
  if (isRegistered(sellerType)) {
    required('registration_number', MESSAGES.registration(REGISTRATION[sellerType]?.agency ?? 'Registration'));
    if (!tinDigits) errors.tin = MESSAGES.tinRequired;
    if (!form.vat_status) errors.vat_status = MESSAGES.vatStatus;
    const certError = documentError(documents.birCert, DOCUMENT_LABELS.birCert);
    if (certError) errors.bir_cert_file = certError;
  }
  if (tinDigits && !TIN_DIGITS.test(tinDigits)) errors.tin = MESSAGES.tinFormat;

  const rsbsaError = documentError(documents.rsbsa, DOCUMENT_LABELS.rsbsa);
  if (rsbsaError) errors.rsbsa_file = rsbsaError;
  const govIdError = documentError(documents.govId, DOCUMENT_LABELS.govId);
  if (govIdError) errors.gov_id_file = govIdError;
  const selfieMissing = selfieError(documents.selfie);
  if (selfieMissing) errors.selfie_file = selfieMissing;
  if (!form.terms_accepted) errors.terms_accepted = MESSAGES.terms;
  return errors;
}

/** The first step with a problem and its errors (web submit), or null when every step passes. */
export function firstInvalidStep(
  form: OnboardingForm,
  proof: ContactProof,
  documents: OnboardingDocuments = NO_DOCUMENTS,
): { index: number; errors: FieldErrors } | null {
  for (const [index, step] of STEPS.entries()) {
    const errors = validateStep(step.id, form, proof, documents);
    if (Object.keys(errors).length) return { index, errors };
  }
  return null;
}

// ── Server errors (web page.tsx OPS_FIELDS, SERVER_FIELD_ALIASES, SHOWN_FIELDS) ─

// The shop name is part of step 1: the Merchant Centre and the draft shop page are created on
// the first save, Submit later included.
export const OPS_FIELDS = new Set<string>([
  'merchant_name', 'address', 'region', 'province', 'city', 'barangay', 'postal_code', 'pin', 'lat', 'lng', 'pin_confirmed',
  'available_days', 'contact_email', 'contact_number', 'email_verification_token', 'phone_verification_token',
]);

export const stepOfField = (field: string): StepId => (OPS_FIELDS.has(field) ? 'ops' : 'legal');

/** Server keys with no message slot of their own, shown under the field they belong to. */
export const SERVER_FIELD_ALIASES: Record<string, FieldKey> = {
  email_verification_token: 'contact_email',
  phone_verification_token: 'contact_number',
  lat: 'pin',
  lng: 'pin',
  pin_confirmed: 'pin',
  terms_version: 'terms_accepted',
};

/** Fields that show a message under themselves. */
export const SHOWN_FIELDS = new Set<string>([
  'address', 'available_days', 'barangay', 'city', 'contact_email', 'contact_number', 'pin', 'postal_code',
  'province', 'region',
  'submit_mode', 'seller_type', 'merchant_name', 'last_name', 'first_name', 'middle_name', 'suffix',
  'sex', 'birth_date', 'rep_last_name', 'rep_first_name', 'rep_middle_name', 'rep_suffix', 'company_name', 'trade_name',
  'registration_number', 'tin', 'vat_status', 'small_agri_producer', 'rsbsa_number', 'gov_id_type',
  'terms_accepted', 'rsbsa_file', 'gov_id_file', 'bir_cert_file', 'selfie_file',
]);

/**
 * The backend's field errors (ApiError.fieldErrors) placed as the web does: each under its
 * field (the first message per field wins), and keys with no field on the form (e.g.
 * "payload") joined for the banner.
 */
export function placeServerErrors(fields: Record<string, string>): { shown: FieldErrors; unplaced: string[] } {
  const shown: FieldErrors = {};
  const unplaced: string[] = [];
  for (const [key, message] of Object.entries(fields)) {
    const field = SERVER_FIELD_ALIASES[key] ?? key;
    if (SHOWN_FIELDS.has(field)) shown[field as FieldKey] ??= message;
    else unplaced.push(message);
  }
  return { shown, unplaced };
}

/** The earliest step with a problem among these fields, or -1 (later steps keep theirs). */
export const firstStepWithProblem = (fields: readonly string[]): number =>
  STEPS.findIndex((s) => fields.some((f) => stepOfField(f) === s.id));

/** Moving on from `step`: its errors are gone, later steps keep the server's (web goNext). */
export function keepOtherSteps(errors: FieldErrors, step: StepId): FieldErrors {
  return Object.fromEntries(Object.entries(errors).filter(([k]) => stepOfField(k) !== step)) as FieldErrors;
}

/** The address form's slice of the errors (the keys are the same). */
export function addressErrorsOf(errors: FieldErrors): AddressErrors {
  const { region, province, city, barangay, address, postal_code, pin } = errors;
  return Object.fromEntries(
    Object.entries({ region, province, city, barangay, address, postal_code, pin }).filter(([, v]) => v),
  ) as AddressErrors;
}

// ── Payload (web submit and businessPayload) ──────────────────────────────────

/** The onboarding payload (web MerchantOnboardingPayload). */
export type OnboardingPayload = {
  submit_mode: SubmitMode;
  seller_type: SellerType;
  merchant_name?: string;
  last_name?: string;
  first_name?: string;
  middle_name?: string;
  suffix?: NameSuffix | '';
  sex?: Sex | '';
  birth_date?: string;
  rep_last_name?: string;
  rep_first_name?: string;
  rep_middle_name?: string;
  rep_suffix?: NameSuffix | '';
  company_name?: string;
  trade_name?: string;
  registration_number?: string;
  tin?: string | null;
  vat_status?: VatStatus | null;
  small_agri_producer?: boolean | null;
  terms_accepted?: boolean;
  terms_version?: string;
  contact_email: string;
  contact_number: string;
  region: string;
  province: string;
  city?: string;
  barangay?: string;
  address: string;
  postal_code?: string;
  lat?: number | null;
  lng?: number | null;
  pin_confirmed?: boolean;
  available_days: string[];
  rsbsa_number?: string;
  gov_id_type?: GovIdType;
  phone_verification_token?: string;
  email_verification_token?: string;
};

/** Section 2 as the server expects it for the seller type: no field the type does not use. */
export function businessPayload(form: OnboardingForm): Partial<OnboardingPayload> {
  const common = {
    merchant_name: form.merchant_name.trim(),
    rsbsa_number: form.rsbsa_number,
    gov_id_type: form.gov_id_type,
    terms_accepted: form.terms_accepted,
    terms_version: TERMS_VERSION,
  };
  const person = {
    last_name: form.last_name.trim(),
    first_name: form.first_name.trim(),
    middle_name: form.middle_name.trim(),
    suffix: form.suffix,
    sex: form.sex,
    birth_date: form.birth_date,
  };
  const registered = {
    registration_number: form.registration_number,
    tin: form.tin,
    vat_status: form.vat_status,
  };
  switch (form.seller_type) {
    case 'individual_farmer':
      return { ...common, ...person, tin: form.tin, small_agri_producer: form.small_agri_producer };
    case 'sole_proprietor':
      return {
        ...common, ...person, ...registered,
        trade_name: form.trade_name.trim(), small_agri_producer: form.small_agri_producer,
      };
    case 'corporation':
      return {
        ...common, ...registered,
        company_name: form.company_name.trim(),
        trade_name: form.trade_name.trim(),
        rep_last_name: form.rep_last_name.trim(),
        rep_first_name: form.rep_first_name.trim(),
        rep_middle_name: form.rep_middle_name.trim(),
        rep_suffix: form.rep_suffix,
      };
    case 'cooperative':
      return { ...common, ...registered, company_name: form.company_name.trim(), trade_name: form.trade_name.trim() };
    default:
      return {};
  }
}

/**
 * The payload of a submit, or null without a submit mode and a seller type (the validation
 * stops that first). "Submit later" sends step 1 (with the shop name) and the seller type only.
 */
export function buildPayload(form: OnboardingForm, proof: ContactProof): OnboardingPayload | null {
  if (!form.submit_mode || !form.seller_type) return null;
  const contact = contactState(form, proof);
  const place = addressPayload(form.location);
  const later = form.submit_mode === 'later';
  return {
    submit_mode: form.submit_mode,
    seller_type: form.seller_type,
    region: place.region,
    province: place.province,
    city: place.city,
    barangay: place.barangay,
    address: place.address,
    postal_code: place.postal_code,
    lat: place.latitude,
    lng: place.longitude,
    pin_confirmed: place.pin_confirmed,
    contact_email: form.contact_email.trim(),
    contact_number: form.contact_number.trim() ? `+63 ${form.contact_number.trim()}` : '',
    available_days: sortDays(form.available_days),
    phone_verification_token: contact.isAccountPhone ? '' : proof.phoneToken ?? '',
    email_verification_token: contact.isAccountEmail ? '' : proof.emailToken ?? '',
    merchant_name: form.merchant_name.trim(),
    ...(later ? {} : businessPayload(form)),
  };
}

/** The file parts a submit sends: none for "Submit later", the BIR form for registered types only. */
export function payloadDocuments(form: OnboardingForm, documents: OnboardingDocuments): OnboardingDocuments {
  if (form.submit_mode === 'later') return NO_DOCUMENTS;
  return { ...documents, birCert: isRegistered(form.seller_type) ? documents.birCert : null };
}

// ── Prefill (web prefill and formFromApplication) ─────────────────────────────

/** Applications the applicant may send again, so the form starts from what they sent. */
export const PREFILL_STATUSES = new Set(['pending_documents', 'clarification', 'rejected']);

/** The saved application as form values. The TIN comes back masked, so it is entered again. */
export function formFromApplication(app: ApiMerchantApplication, current: OnboardingForm): OnboardingForm {
  const text = (value: string | null | undefined) => value ?? '';
  const suffix = (value: string | null) =>
    (NAME_SUFFIXES as readonly string[]).includes(value ?? '') ? (value as NameSuffix) : '';
  const govId = (GOV_ID_TYPES as readonly string[]).includes(app.gov_id_type ?? '')
    ? (app.gov_id_type as GovIdType)
    : INITIAL_FORM.gov_id_type;
  const pinned = app.lat != null && app.lng != null;
  return {
    ...current,
    location: {
      region: text(app.region),
      province: text(app.province),
      city: text(app.city),
      barangay: text(app.barangay),
      street: text(app.address),
      postal_code: text(app.postal_code),
      // The pin saved with step 1 (kept, so finishing later does not ask again).
      latitude: pinned ? app.lat ?? null : current.location.latitude,
      longitude: pinned ? app.lng ?? null : current.location.longitude,
      pin_confirmed: pinned ? app.pin_confirmed === true : current.location.pin_confirmed,
    },
    available_days: app.available_days?.length ? sortDays(app.available_days) : INITIAL_FORM.available_days,
    contact_email: app.contact_email,
    contact_number: formatLocalPhone(app.contact_number.replace(/^\+63/, '')),
    seller_type: app.seller_type,
    merchant_name: text(app.merchant_name),
    last_name: text(app.last_name),
    first_name: text(app.first_name),
    middle_name: text(app.middle_name),
    suffix: suffix(app.suffix),
    sex: app.sex === 'male' || app.sex === 'female' ? app.sex : '',
    birth_date: text(app.birth_date),
    rep_last_name: text(app.rep_last_name),
    rep_first_name: text(app.rep_first_name),
    rep_middle_name: text(app.rep_middle_name),
    rep_suffix: suffix(app.rep_suffix),
    company_name: text(app.company_name),
    trade_name: text(app.trade_name),
    registration_number: text(app.registration_number),
    vat_status: app.vat_status,
    small_agri_producer: app.small_agri_producer,
    gov_id_type: govId,
  };
}

/** The profile prefill: empty boxes only take the account's email, number and default address. */
export function formFromProfile(
  current: OnboardingForm,
  profile: {
    email: string | null;
    phone_number: string | null;
    address?: { address: string | null; city: string | null; province: string | null; postal_code: string | null } | null;
  },
): OnboardingForm {
  const a = profile.address;
  return {
    ...current,
    contact_email: current.contact_email || profile.email || '',
    contact_number: current.contact_number || formatLocalPhone(profile.phone_number?.replace(/^\+63\s?/, '') ?? ''),
    location: {
      ...current.location,
      street: current.location.street || (a?.address ?? ''),
      city: current.location.city || (a?.city ?? ''),
      province: current.location.province || (a?.province ?? ''),
      postal_code: current.location.postal_code || (a?.postal_code ?? ''),
    },
  };
}

// ── Step 1 words (web page.tsx) ───────────────────────────────────────────────

export const OPS_WORDS = {
  merchantName: 'Merchant name',
  merchantNamePlaceholder: 'Carabao Fresh Farm',
  merchantNameHelp: 'The store name buyers see. Your Merchant Centre opens as soon as you save this step.',
  availableDays: 'Available days',
  contactEmail: 'Contact email',
  contactEmailPlaceholder: 'you@farm.com',
  contactNumber: 'Contact number',
  contactNumberPlaceholder: '912 345 6789',
  back: 'Back',
  continue: 'Continue',
} as const;

// ── Step 2 words (web page.tsx, legal step) ───────────────────────────────────

export const LEGAL_WORDS = {
  submitMode: 'Submit business information?',
  sellerType: 'Seller type',
  legalName: 'Legal name',
  lastName: 'Last name',
  firstName: 'First name',
  middleName: 'Middle name (optional)',
  suffix: 'Suffix (optional)',
  suffixNone: 'None',
  sex: 'Sex',
  birthDate: 'Birth date',
  nameHelp: 'Your full legal name as written on your government-issued ID.',
  representative: 'Authorized representative',
  companyName: 'Company registered name',
  coopName: 'Cooperative registered name',
  companyPlaceholder: 'Carabao Agri Trading Corp.',
  coopPlaceholder: 'Malolos Farmers Multi-Purpose Cooperative',
  tradeName: 'Business / trade name',
  tradeNameOptional: 'Business / trade name (optional)',
  tradeNamePlaceholder: 'Carabao Fresh',
  taxInformation: 'Tax information',
  tin: 'TIN',
  tinOptional: 'TIN (optional)',
  tinPlaceholder: '999-999-999-000',
  tinHelpRegistered: '9 digits plus your branch code. Use 000 if there is no branch.',
  tinHelpOptional: 'You can add this later. If you enter it: 9 digits plus the branch code (000 if there is no branch).',
  vatStatus: 'VAT registration status',
  birCert: 'BIR Certificate of Registration (Form 2303)',
  smallProducer: 'Declare as small agricultural producer',
  documents: 'Documents',
  rsbsaNumber: 'RSBSA number (optional)',
  rsbsaPlaceholder: 'RSBSA-XXXX-XXXX',
  rsbsaFile: 'RSBSA document (photo or PDF)',
  govId: 'Government ID',
  govIdRep: "Authorized representative's government ID",
  saving: 'Saving…',
  saveLater: 'Save and finish later',
  submit: 'Submit',
  phoneReason: 'Merchant accounts need a verified mobile number.',
  submitFailed: 'Unable to submit your merchant application right now. Please try again.',
} as const;

export const VAT_OPTIONS: { value: VatStatus; label: string }[] = [
  { value: 'vat_registered', label: 'VAT-registered' },
  { value: 'non_vat', label: 'Non-VAT' },
];

export const YES_NO_OPTIONS: { value: boolean; label: string }[] = [
  { value: true, label: 'Yes' },
  { value: false, label: 'No' },
];

/** The documents intro (web page.tsx): the corporation names its representative. */
export const documentsIntro = (type: SellerType | null): string =>
  'Upload a clear photo or a PDF scan of your Philippine RSBSA document and of one valid government ID'
  + `${type === 'corporation' ? ' of your authorized representative' : ''}.`;

/** The government ID label: the representative's for a corporation (web govIdLabel). */
export const govIdLabel = (type: SellerType | null): string =>
  type === 'corporation' ? LEGAL_WORDS.govIdRep : LEGAL_WORDS.govId;

/** The last button of the form (web footer). */
export const submitLabel = (submitting: boolean, later: boolean): string =>
  submitting ? LEGAL_WORDS.saving : later ? LEGAL_WORDS.saveLater : LEGAL_WORDS.submit;

/** `?step=business` (dashboard checklist, reminders) opens the legal step, as on the web. */
export const initialStepIndex = (step: string | string[] | undefined): number => {
  const value = Array.isArray(step) ? step[0] : step;
  return value === 'business' ? Math.max(STEPS.findIndex((s) => s.id === 'legal'), 0) : 0;
};

// ── Documents (S18: expo-document-picker, then the S2 checks) ─────────────────

/** The type of a picked document: the picker's own, else read from the file name. */
export function documentMimeType(name: string, mimeType?: string | null): string | null {
  const given = (mimeType ?? '').trim().toLowerCase();
  if (given && given !== 'application/octet-stream') return given;
  const ext = /\.([A-Za-z0-9]+)$/.exec(name.trim())?.[1]?.toLowerCase();
  const byName =
    ext === 'pdf' ? 'application/pdf'
      : ext === 'png' ? 'image/png'
        : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
          : ext === 'webp' ? 'image/webp'
            : null;
  return byName ?? (given || null);
}

/** One expo-document-picker asset as the form keeps it. */
export function pickedDocument(asset: {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
}): OnboardingDocument {
  const name = asset.name?.trim() || asset.uri.split(/[\\/]/).pop()?.split(/[?#]/)[0] || 'document';
  return {
    uri: asset.uri,
    name,
    mimeType: documentMimeType(name, asset.mimeType),
    size: typeof asset.size === 'number' ? asset.size : null,
  };
}

/** The card line under a picked file (web DocumentDropzone): "PDF · 245 KB". */
export function documentMeta(doc: OnboardingDocument): string {
  const kind = doc.mimeType === 'application/pdf' ? 'PDF' : (doc.mimeType?.split('/')[1]?.toUpperCase() ?? '');
  return doc.size == null ? kind : `${kind} · ${(doc.size / 1024).toFixed(0)} KB`;
}

/** Sum of the known file sizes a submit sends. */
export const documentsBytes = (documents: OnboardingDocuments): number =>
  [documents.rsbsa, documents.govId, documents.birCert, documents.selfie].reduce((sum, d) => sum + (d?.size ?? 0), 0);

/** The backend 413 words (core/body_limit.py _detail). */
export const bodyLimitMessage = (limitBytes: number): string =>
  `Request body must be under ${Math.floor(limitBytes / (1024 * 1024))} MB`;

/**
 * The 413 the server would send, before the upload starts, or null. The JSON payload is a few
 * KB, so the files alone are checked against the limit.
 */
export function bodyLimitProblem(documents: OnboardingDocuments, limitBytes: number): string | null {
  return documentsBytes(documents) >= limitBytes ? bodyLimitMessage(limitBytes) : null;
}
