"use client";

import errorHelper, { getApiFieldErrors, isPhoneVerificationRequired } from "@/util/errorHelper";
import FieldError, { FieldErrors, focusFirstInvalid, invalidClass, invalidProps } from "@/components/FieldError/FieldError";
import PhoneVerifyDialog from "@/components/PhoneVerifyDialog/PhoneVerifyDialog";
import { TERMS_EFFECTIVE_DATE } from "@/components/TermsModal/TermsOfServiceContent";
import { displayEmail, normalizePhMobile } from "@/lib/phone";
import { sendPhoneCode, verifyMyPhone } from "@/lib/auth-client";

import { useEffect, useState, type ReactNode } from "react";
import { NCR_PROVINCE } from "@/util/serviceArea";
import { MERCHANT_PAGES } from "@/lib/merchant-links";
import { helpUrl, merchantUrl } from "@/lib/urls";
import styles from "./page.module.css";
import LocationSelects from "@/components/LocationSelects/LocationSelects";
import MapPinPicker from "@/components/MapPinPicker/MapPinPicker";
import ContactCodeField from "./ContactCodeField";
import DocumentDropzone, { documentError } from "./DocumentDropzone";
import SelfieCapture, { selfieError } from "./SelfieCapture";
import {
  defaultAddress,
  fetchMyProfile,
  fetchMyMerchantApplication,
  submitMyMerchantOnboarding,
  sendOtp,
  verifyOtp,
  sendEmailOtp,
  verifyEmailOtp,
  GOV_ID_TYPES,
  NAME_SUFFIXES,
  type Sex,
  MerchantOnboardingPayload,
  MerchantApplication,
  type GovIdType,
  type NameSuffix,
  type SellerType,
  type SubmitMode,
  type VatStatus,
} from "@/util/api";
import { CLARIFICATION_SECTIONS, type ClarificationSection } from "@/util/api/admin";

type StepId = "ops" | "legal";

/** Everything the form holds; the payload sent is built from it per seller type (businessPayload). */
type FormState = {
  region: string;
  province: string;
  city: string;
  barangay: string;
  address: string;
  postal_code: string;
  lat?: number | null;
  lng?: number | null;
  pin_confirmed?: boolean;
  available_days: string[];
  contact_email: string;
  contact_number: string;
  submit_mode: SubmitMode | null;
  seller_type: SellerType | null;
  merchant_name: string;
  last_name: string;
  first_name: string;
  middle_name: string;
  suffix: NameSuffix | "";
  sex: Sex | "";
  /** YYYY-MM-DD, from the date input. */
  birth_date: string;
  rep_last_name: string;
  rep_first_name: string;
  rep_middle_name: string;
  rep_suffix: NameSuffix | "";
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
type TextKey = {
  [K in keyof FormState]-?: FormState[K] extends string ? K : never;
}[keyof FormState];
// Form fields plus the parts of the form that are not payload fields.
type FieldKey = keyof FormState | "pin" | "rsbsa_file" | "gov_id_file" | "bir_cert_file" | "selfie_file";

// The shop name is part of step 1: the Merchant Centre and the draft shop
// page are created on the first save, Submit later included.
const OPS_FIELDS = new Set<string>([
  "merchant_name", "address", "region", "province", "city", "barangay", "postal_code", "pin", "lat", "lng", "pin_confirmed",
  "available_days", "contact_email", "contact_number", "email_verification_token", "phone_verification_token",
]);
const stepOfField = (field: string): StepId => (OPS_FIELDS.has(field) ? "ops" : "legal");
// Server keys with no message slot of their own, shown under the field they belong to.
const SERVER_FIELD_ALIASES: Record<string, FieldKey> = {
  email_verification_token: "contact_email",
  phone_verification_token: "contact_number",
  lat: "pin",
  lng: "pin",
  pin_confirmed: "pin",
  terms_version: "terms_accepted",
};
// Fields that show a message under themselves (keep in step with the JSX below).
const SHOWN_FIELDS = new Set<string>([
  "address", "available_days", "barangay", "city", "contact_email", "contact_number", "pin", "postal_code",
  "province", "region",
  "submit_mode", "seller_type", "merchant_name", "last_name", "first_name", "middle_name", "suffix",
  "sex", "birth_date", "rep_last_name", "rep_first_name", "rep_middle_name", "rep_suffix", "company_name", "trade_name",
  "registration_number", "tin", "vat_status", "small_agri_producer", "rsbsa_number", "gov_id_type",
  "terms_accepted", "rsbsa_file", "gov_id_file", "bir_cert_file", "selfie_file",
]);
// NCR has no provinces; the payload still needs one (backend requires it).
const isNcrRegion = (region: string) => /\b(ncr|national capital|metro manila)\b/i.test(region);
// Limits (backend MERCHANT_NAME_MAX, PERSON_NAME_MAX, COMPANY_NAME_MAX).
const NAME_MAX = 50;
const PERSON_MAX = 80;
const COMPANY_MAX = 255;

const STEPS: { id: StepId; title: string; subtitle: string }[] = [
  { id: "ops", title: "Operations & Contact", subtitle: "Where you operate, and a verified email and number." },
  { id: "legal", title: "Business Information", subtitle: "Who is selling, tax details and documents: now or later." },
];

const SELLER_OPTIONS: { value: SellerType; label: string }[] = [
  { value: "individual_farmer", label: "Individual farmer (not business-registered)" },
  { value: "sole_proprietor", label: "Sole proprietorship" },
  { value: "corporation", label: "Corporation / Partnership / One Person Corporation" },
  { value: "cooperative", label: "Cooperative" },
];

/** The agency each registered seller type implies (backend REGISTRATION_FOR_SELLER). */
const REGISTRATION: Partial<Record<SellerType, { agency: string; placeholder: string; hint: string }>> = {
  sole_proprietor: {
    agency: "DTI",
    placeholder: "e.g. 3456789",
    hint: "The number on your DTI Certificate of Business Name Registration.",
  },
  corporation: {
    agency: "SEC",
    placeholder: "e.g. CS201912345",
    hint: "The SEC registration number on your Certificate of Incorporation or Registration.",
  },
  cooperative: {
    agency: "CDA",
    placeholder: "e.g. 9520-12345678",
    hint: "The registration number on your CDA Certificate of Registration.",
  },
};

const isRegistered = (type: SellerType | null) => type !== null && type !== "individual_farmer";
const isIndividual = (type: SellerType | null) => type === "individual_farmer" || type === "sole_proprietor";

const SMALL_PRODUCER_HELP =
  "Choose Yes if you sell agricultural food products you produce and your total yearly gross sales are " +
  "₱1,000,000 or less. Under BIR RR No. 12-2023 you don't need to issue invoices for those sales, but you " +
  "must keep a simplified sales book. Business buyers don't withhold tax on their first ₱300,000 of " +
  "purchases from you each year.";
const SUBMIT_LATER_HELP =
  "You can submit your business information later if you don't have your documents yet, but you can't " +
  "start selling until you do.";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 9 digits plus a 3-5 digit branch code (backend normalize_tin).
const TIN_DIGITS = /^\d{12,14}$/;

/** 999-999-999-000, with a branch code of up to 5 digits. */
function formatTIN(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 14);
  const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9), digits.slice(9)];
  return parts.filter(Boolean).join("-");
}

function formatLocalPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  const a = digits.slice(0, 3);
  const b = digits.slice(3, 6);
  const c = digits.slice(6, 10);
  return [a, b, c].filter(Boolean).join(" ");
}

function formatRegNum(raw: string): string {
  return raw.replace(/[^A-Za-z0-9-]/g, "").toUpperCase().slice(0, 30);
}

function formatRSBSA(raw: string): string {
  if (!raw) return "";
  const stripped = raw.toUpperCase().replace(/^RSBSA-?/, "").replace(/[^A-Z0-9]/g, "").slice(0, 16);
  if (!stripped) return "";
  const parts: string[] = [];
  for (let i = 0; i < stripped.length; i += 4) parts.push(stripped.slice(i, i + 4));
  return `RSBSA-${parts.join("-")}`;
}

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const INITIAL_FORM: FormState = {
  region: "",
  province: "",
  city: "",
  barangay: "",
  address: "",
  postal_code: "",
  available_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  contact_email: "",
  contact_number: "",
  submit_mode: null,
  seller_type: null,
  merchant_name: "",
  last_name: "",
  first_name: "",
  middle_name: "",
  suffix: "",
  sex: "",
  birth_date: "",
  rep_last_name: "",
  rep_first_name: "",
  rep_middle_name: "",
  rep_suffix: "",
  company_name: "",
  trade_name: "",
  registration_number: "",
  tin: "",
  vat_status: null,
  small_agri_producer: null,
  rsbsa_number: "",
  gov_id_type: "PhilSys National ID",
  terms_accepted: false,
};

/**
 * Applications the applicant finishes or corrects, so the form starts from
 * what they sent. A rejected application starts over with an empty form.
 */
const PREFILL_STATUSES = new Set(["pending_documents", "clarification"]);
/** Applications whose contact email and number were verified when sent. */
const SAVED_CONTACT_STATUSES = new Set(["pending_documents", "clarification", "rejected"]);

/**
 * The flagged sections of a clarification request, or null when every
 * section is open (no request, or none flagged).
 */
function flaggedSections(app: MerchantApplication | null): Set<ClarificationSection> | null {
  if (app?.status !== "clarification" || !app.clarification_sections?.length) return null;
  return new Set(app.clarification_sections);
}

/**
 * A group of fields from one clarification section. Not flagged: the
 * fields are disabled, and the server keeps what was sent.
 */
function SectionLock({ open, flagged, children }: { open: boolean; flagged: boolean; children: ReactNode }) {
  return (
    <fieldset disabled={!open} className={styles.sectionLock}>
      {flagged && (
        <p className={`${styles.fieldFull} ${open ? styles.sectionFlagged : styles.sectionLocked}`}>
          {open ? "Flagged by Carabao: change this section." : "Not flagged: this section stays as you sent it."}
        </p>
      )}
      {children}
    </fieldset>
  );
}

const SEXES: { value: Sex; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];
const MIN_SELLER_AGE = 18;

/** The latest birth date of an adult seller, as YYYY-MM-DD (local date). */
function latestBirthDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - MIN_SELLER_AGE);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The same rule as the server (schemas/merchant_application.py _Person). */
function birthDateError(value: string): string | null {
  if (!value) return "Birth date is required.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < new Date().getFullYear() - 120)
    return "Enter the birth date on your government ID.";
  if (value > latestBirthDate()) return `You must be at least ${MIN_SELLER_AGE} years old.`;
  return null;
}

/** The saved application as form values. The TIN comes back masked, so it is entered again. */
function formFromApplication(app: MerchantApplication): Partial<FormState> {
  const text = (value: string | null | undefined) => value ?? "";
  const suffix = (value: string | null) =>
    (NAME_SUFFIXES as readonly string[]).includes(value ?? "") ? (value as NameSuffix) : "";
  const govId = (GOV_ID_TYPES as readonly string[]).includes(app.gov_id_type ?? "")
    ? (app.gov_id_type as GovIdType)
    : INITIAL_FORM.gov_id_type;
  return {
    region: text(app.region),
    province: text(app.province),
    city: text(app.city),
    barangay: text(app.barangay),
    address: text(app.address),
    postal_code: text(app.postal_code),
    available_days: app.available_days?.length ? app.available_days : INITIAL_FORM.available_days,
    // The pin saved with step 1 (kept, so finishing later does not ask again).
    ...(app.lat != null && app.lng != null
      ? { lat: app.lat, lng: app.lng, pin_confirmed: app.pin_confirmed === true }
      : {}),
    contact_email: app.contact_email,
    contact_number: formatLocalPhone(app.contact_number.replace(/^\+63/, "")),
    seller_type: app.seller_type,
    merchant_name: text(app.merchant_name),
    last_name: text(app.last_name),
    first_name: text(app.first_name),
    middle_name: text(app.middle_name),
    suffix: suffix(app.suffix),
    sex: app.sex === "male" || app.sex === "female" ? app.sex : "",
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

/** Section 2 as the server expects it for the seller type: no field the type does not use. */
function businessPayload(form: FormState): Partial<MerchantOnboardingPayload> {
  const type = form.seller_type;
  const common = {
    merchant_name: form.merchant_name.trim(),
    rsbsa_number: form.rsbsa_number,
    gov_id_type: form.gov_id_type,
    terms_accepted: form.terms_accepted,
    terms_version: TERMS_EFFECTIVE_DATE,
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
  switch (type) {
    case "individual_farmer":
      return { ...common, ...person, tin: form.tin, small_agri_producer: form.small_agri_producer };
    case "sole_proprietor":
      return {
        ...common, ...person, ...registered,
        trade_name: form.trade_name.trim(), small_agri_producer: form.small_agri_producer,
      };
    case "corporation":
      return {
        ...common, ...registered,
        company_name: form.company_name.trim(),
        trade_name: form.trade_name.trim(),
        rep_last_name: form.rep_last_name.trim(),
        rep_first_name: form.rep_first_name.trim(),
        rep_middle_name: form.rep_middle_name.trim(),
        rep_suffix: form.rep_suffix,
      };
    case "cooperative":
      return { ...common, ...registered, company_name: form.company_name.trim(), trade_name: form.trade_name.trim() };
    default:
      return {};
  }
}

type RadioProps<T extends string | boolean> = {
  id: string;
  legend: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string;
  help?: ReactNode;
  stacked?: boolean;
  disabled?: boolean;
};

function RadioGroup<T extends string | boolean>({
  id, legend, options, value, onChange, error, help, stacked, disabled,
}: RadioProps<T>) {
  return (
    <div className={`${styles.field} ${styles.fieldFull}${invalidClass(error)}`}>
      <fieldset
        className={`${styles.radioGroup} ${stacked ? styles.radioGroupStacked : ""}`}
        aria-labelledby={`${id}-legend`}
        {...invalidProps(id, error)}
      >
        <legend id={`${id}-legend`} className={styles.label}>{legend}</legend>
        {options.map((option) => {
          const checked = value === option.value;
          return (
            <label key={String(option.value)} className={`${styles.radioOption} ${checked ? styles.radioOptionActive : ""}`}>
              <input
                type="radio"
                name={id}
                checked={checked}
                onChange={() => onChange(option.value)}
                disabled={disabled}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </fieldset>
      {help && <p className={styles.helper}>{help}</p>}
      <FieldError id={id} message={error} />
    </div>
  );
}

type TextFieldProps = {
  id: string;
  label: string;
  value: string;
  max: number;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  help?: string;
  full?: boolean;
  counter?: boolean;
  inputMode?: "numeric" | "text";
};

function TextField({ id, label, value, max, onChange, error, placeholder, help, full, counter = true, inputMode }: TextFieldProps) {
  return (
    <div className={`${styles.field}${full ? ` ${styles.fieldFull}` : ""}${invalidClass(error)}`}>
      <div className={styles.labelRow}>
        <label htmlFor={id} className={styles.label}>{label}</label>
        {counter && <span className={styles.charCount} aria-hidden="true">{value.length}/{max}</span>}
      </div>
      <input
        {...invalidProps(id, error)}
        id={id}
        className={styles.input}
        maxLength={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
      />
      {help && <p className={styles.helper}>{help}</p>}
      <FieldError id={id} message={error} />
    </div>
  );
}

export default function MerchantOnboardingPage() {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex] ?? STEPS[0]!;

  const [rsbsaFile, setRsbsaFile] = useState<File | null>(null);
  const [govIdFile, setGovIdFile] = useState<File | null>(null);
  const [birCertFile, setBirCertFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Errors that belong to no field (network, server); field errors show under each field.
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<FieldKey>>({});
  const [scrollRequest, setScrollRequest] = useState(0);
  const [successApplication, setSuccessApplication] = useState<MerchantApplication | null>(null);

  // The account's own verified number and email need no second code.
  // Applying needs a verified account number at all (backend require_verified_phone).
  const [accountPhone, setAccountPhone] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [needsAccountPhone, setNeedsAccountPhone] = useState(false);
  // Tokens from /sms/otp/verify and /email/otp/verify. A changed value clears its token.
  const [phoneVerificationToken, setPhoneVerificationToken] = useState<string | null>(null);
  const [emailVerificationToken, setEmailVerificationToken] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  // The saved application (Submit later, sent back, or rejected), if any.
  const [application, setApplication] = useState<MerchantApplication | null>(null);
  const flags = flaggedSections(application);
  const isOpen = (section: ClarificationSection) => flags === null || flags.has(section);
  const clarifying = application?.status === "clarification";
  // A document not flagged for changes stays as sent (no new upload).
  const storedDocument = {
    rsbsa: application?.rsbsa_document_original_name ?? null,
    govId: application?.gov_id_document_original_name ?? null,
    birCert: application?.bir_cert_document_original_name ?? null,
    selfie: application?.selfie_document_original_name ?? null,
  };
  // The selfie has its own clarification section; the other files are "documents".
  const keepsDocument = (kind: keyof typeof storedDocument) =>
    !isOpen(kind === "selfie" ? "selfie" : "documents") && !!storedDocument[kind];

  const later = form.submit_mode === "later";
  const sellerType = form.seller_type;
  const registration = sellerType ? REGISTRATION[sellerType] : undefined;

  // After the invalid fields render, bring the first one into view.
  useEffect(() => {
    if (scrollRequest) focusFirstInvalid();
  }, [scrollRequest]);

  const clearErrors = (...keys: FieldKey[]) =>
    setFieldErrors((prev) => {
      if (!keys.some((k) => k in prev)) return prev;
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });

  const showFieldErrors = (errors: FieldErrors<FieldKey>) => {
    setFieldErrors(errors);
    setScrollRequest((n) => n + 1);
  };

  useEffect(() => {
    const prefill = async () => {
      try {
        const p = await fetchMyProfile();
        const a = defaultAddress(p.addresses);
        const email = displayEmail(p.email);
        setAccountPhone(p.phone_verified ? p.phone_number : null);
        setAccountEmail(p.email_verified && email ? normalizeEmail(email) : null);
        setForm((prev) => ({
          ...prev,
          contact_email: prev.contact_email || email || "",
          contact_number: prev.contact_number || formatLocalPhone(p.phone_number?.replace(/^\+63\s?/, "") ?? ""),
          address: prev.address || (a?.address ?? ""),
          city: prev.city || (a?.city ?? ""),
          province: prev.province || (a?.province ?? ""),
          postal_code: prev.postal_code || (a?.postal_code ?? ""),
        }));
      } catch {
        // No prefill on error.
      }
      // Finishing a saved application (Submit later, or one sent back): start
      // from what was sent. The map pin and the documents are given again.
      try {
        const application = await fetchMyMerchantApplication();
        if (application && SAVED_CONTACT_STATUSES.has(application.status)) setApplication(application);
        if (application && PREFILL_STATUSES.has(application.status)) {
          const sentBack = application.status === "clarification";
          setForm((prev) => ({
            ...prev,
            ...formFromApplication(application),
            // A clarification is answered with Submit now.
            ...(sentBack ? { submit_mode: "now" as const } : {}),
            // A locked business section keeps its TIN: show the masked one.
            ...(sentBack && flaggedSections(application) && !flaggedSections(application)!.has("business")
              ? { tin: application.tin ?? "" }
              : {}),
          }));
          // From the dashboard checklist or a reminder: open the business step.
          if (new URLSearchParams(window.location.search).get("step") === "business") {
            const legal = STEPS.findIndex((s) => s.id === "legal");
            if (legal !== -1) setStepIndex(legal);
          }
        }
      } catch {
        // No prefill on error.
      }
    };
    void prefill();
  }, []);

  const fullPhoneNumber = `+63${form.contact_number.replace(/\s/g, "")}`;
  // Verified once is enough: the account's own number and email, and the ones
  // this application already saved (verified when sent), need no new code.
  const savedPhone = application ? normalizePhMobile(application.contact_number) : null;
  const savedEmail = application ? normalizeEmail(application.contact_email) : null;
  const typedPhone = normalizePhMobile(fullPhoneNumber);
  const isAccountPhone = accountPhone !== null && typedPhone === accountPhone;
  const isKnownPhone = isAccountPhone || (typedPhone !== null && typedPhone === savedPhone);
  const phoneVerified = isKnownPhone || phoneVerificationToken !== null;
  const typedEmail = normalizeEmail(form.contact_email);
  const isAccountEmail = accountEmail !== null && typedEmail === accountEmail;
  const isKnownEmail = isAccountEmail || (typedEmail !== "" && typedEmail === savedEmail);
  const emailVerified = isKnownEmail || emailVerificationToken !== null;

  const setField =
    <K extends keyof FormState>(key: K) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const value = e.target.value;
        setForm((prev) => ({ ...prev, [key]: value }) as FormState);
        clearErrors(key);
      };

  const setValue = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    clearErrors(key);
  };

  const setText = (key: TextKey) => (value: string) => setValue(key, value);

  // A new number or email is unverified again and needs a new code.
  const handlePhone = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = formatLocalPhone(e.target.value);
    if (next === form.contact_number) return;
    setForm((prev) => ({ ...prev, contact_number: next }));
    setPhoneVerificationToken(null);
    clearErrors("contact_number");
  };

  const handleEmail = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    if (normalizeEmail(next) !== normalizeEmail(form.contact_email)) setEmailVerificationToken(null);
    setForm((prev) => ({ ...prev, contact_email: next }));
    clearErrors("contact_email");
  };

  const toggleDay = (day: (typeof DAYS)[number]) => {
    setForm((prev) => {
      const set = new Set(prev.available_days);
      if (set.has(day)) set.delete(day);
      else set.add(day);
      return { ...prev, available_days: Array.from(set) };
    });
    clearErrors("available_days");
  };

  const validateEmail = () =>
    EMAIL_PATTERN.test(form.contact_email.trim()) ? null : "Enter a valid email, e.g. you@farm.com.";
  const validatePhone = () =>
    normalizePhMobile(fullPhoneNumber) ? null : "Enter a Philippine mobile number, e.g. 912 345 6789.";

  // No verified account number yet: the code verifies this number on the
  // account (BetterAuth), and that also proves the contact number.
  const sendPhone = async () => {
    if (accountPhone === null) await sendPhoneCode(fullPhoneNumber);
    else await sendOtp(fullPhoneNumber);
  };
  const verifyPhone = async (code: string) => {
    if (accountPhone === null) {
      await verifyMyPhone(fullPhoneNumber, code);
      setAccountPhone(normalizePhMobile(fullPhoneNumber));
    } else {
      setPhoneVerificationToken(await verifyOtp(fullPhoneNumber, code));
    }
    clearErrors("contact_number");
  };
  const sendEmail = () => sendEmailOtp(form.contact_email.trim());
  const verifyEmail = async (code: string) => {
    setEmailVerificationToken(await verifyEmailOtp(form.contact_email.trim(), code));
    clearErrors("contact_email");
  };

  // Every problem in a step, keyed by field. Mirrors the backend payload models.
  const validateStep = (id: StepId): FieldErrors<FieldKey> => {
    const errors: FieldErrors<FieldKey> = {};
    // A section not flagged in a clarification request is kept as sent: not checked here.
    if (id === "ops") {
      const merchantName = form.merchant_name.trim();
      if (isOpen("store")) {
        if (!merchantName) errors.merchant_name = "Merchant name is required.";
        else if (merchantName.length < 3) errors.merchant_name = "Merchant name must be at least 3 characters.";
      }
      if (isOpen("location")) {
        if (!form.address.trim()) errors.address = "Enter your street / house no.";
        if (!form.region.trim()) errors.region = "Select your region.";
        else if (!form.province.trim() && !isNcrRegion(form.region)) errors.province = "Select your province.";
        if (form.region.trim() && !form.city?.trim()) errors.city = "Select your city / municipality.";
        if (form.city?.trim() && !form.barangay?.trim()) errors.barangay = "Select your barangay.";
        if (!form.postal_code?.trim()) errors.postal_code = "Postal code is required.";
        // The farm needs a pin (deliveries start there); a suggested one counts only once confirmed.
        if (form.lat == null) errors.pin = "Place your pin on the map at your gate or door.";
        else if (!form.pin_confirmed) errors.pin = "Put the pin at your gate or door, then click “Confirm pin”.";
        if (!Array.isArray(form.available_days) || form.available_days.length === 0)
          errors.available_days = "Select at least one available day.";
      }
      if (isOpen("contact")) {
        if (!form.contact_email.trim()) errors.contact_email = "Contact email is required.";
        else if (!emailVerified) errors.contact_email = "Verify your contact email first.";
        if (!phoneVerified) errors.contact_number = "Verify your contact number first.";
      }
      return errors;
    }
    if (!form.submit_mode) errors.submit_mode = "Choose Submit now or Submit later.";
    if (!sellerType) errors.seller_type = "Select your seller type.";
    if (later || !sellerType) return errors;
    if (!form.terms_accepted) errors.terms_accepted = "Accept the Terms of Service and Data Privacy Policy to submit.";
    const fileError = (kind: keyof typeof storedDocument, file: File | null, label: string) =>
      keepsDocument(kind) ? null : documentError(file, label);
    if (isRegistered(sellerType)) {
      const certError = fileError("birCert", birCertFile, "BIR Certificate of Registration (Form 2303)");
      if (certError) errors.bir_cert_file = certError;
    }
    const rsbsaError = fileError("rsbsa", rsbsaFile, "RSBSA document");
    if (rsbsaError) errors.rsbsa_file = rsbsaError;
    const govIdError = fileError("govId", govIdFile, "government ID");
    if (govIdError) errors.gov_id_file = govIdError;
    const selfieMissing = keepsDocument("selfie") ? null : selfieError(selfieFile);
    if (selfieMissing) errors.selfie_file = selfieMissing;
    if (!isOpen("business")) return errors;

    const required = (key: TextKey, message: string) => {
      if (!form[key].trim()) errors[key] = message;
    };
    if (isIndividual(sellerType)) {
      required("last_name", "Last name is required.");
      required("first_name", "First name is required.");
      if (!form.sex) errors.sex = "Sex is required.";
      const birthError = birthDateError(form.birth_date);
      if (birthError) errors.birth_date = birthError;
      if (form.small_agri_producer === null)
        errors.small_agri_producer = "Choose Yes or No for the small agricultural producer declaration.";
    }
    if (sellerType === "sole_proprietor") required("trade_name", "Business / trade name is required.");
    if (sellerType === "corporation") {
      required("company_name", "Company registered name is required.");
      required("trade_name", "Business / trade name is required.");
      required("rep_last_name", "Representative's last name is required.");
      required("rep_first_name", "Representative's first name is required.");
    }
    if (sellerType === "cooperative") required("company_name", "Cooperative registered name is required.");

    const tinDigits = form.tin.replace(/\D/g, "");
    if (isRegistered(sellerType)) {
      required("registration_number", `${registration?.agency ?? "Registration"} number is required.`);
      if (!tinDigits) errors.tin = "TIN is required.";
      if (!form.vat_status) errors.vat_status = "Choose your VAT registration status.";
    }
    if (tinDigits && !TIN_DIGITS.test(tinDigits))
      errors.tin = "Enter the 9-digit TIN plus the 3-5 digit branch code, e.g. 123-456-789-000.";
    return errors;
  };

  const goNext = () => {
    setError(null);
    const errors = validateStep(step.id);
    if (Object.keys(errors).length) return showFieldErrors(errors);
    // Keep server errors for later steps, so they show when the user gets there.
    setFieldErrors((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([k]) => stepOfField(k) !== step.id)) as FieldErrors<FieldKey>,
    );
    setStepIndex((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const goBack = () => {
    setError(null);
    setFieldErrors({});
    setStepIndex((s) => Math.max(s - 1, 0));
  };

  const submit = async () => {
    setError(null);
    // Take the user to the first step with problems and mark each field there.
    for (const [idx, s] of STEPS.entries()) {
      const errors = validateStep(s.id);
      if (Object.keys(errors).length) {
        setStepIndex(idx);
        return showFieldErrors(errors);
      }
    }
    if (!form.submit_mode || !sellerType) return;
    setIsSubmitting(true);
    try {
      const dayOrder = (d: string) => {
        const idx = DAYS.indexOf(d as (typeof DAYS)[number]);
        return idx === -1 ? 999 : idx;
      };
      const payload: MerchantOnboardingPayload = {
        submit_mode: form.submit_mode,
        seller_type: sellerType,
        region: form.region,
        province: form.province.trim() || (isNcrRegion(form.region) ? NCR_PROVINCE : ""),
        city: form.city,
        barangay: form.barangay,
        address: form.address,
        postal_code: form.postal_code,
        lat: form.lat,
        lng: form.lng,
        pin_confirmed: form.pin_confirmed,
        contact_email: form.contact_email.trim(),
        contact_number: form.contact_number.trim() ? `+63 ${form.contact_number.trim()}` : "",
        available_days: [...form.available_days].sort((a, b) => dayOrder(a) - dayOrder(b)),
        phone_verification_token: isKnownPhone ? "" : phoneVerificationToken ?? "",
        email_verification_token: isKnownEmail ? "" : emailVerificationToken ?? "",
        merchant_name: form.merchant_name.trim(),
        // Submit later sends step 1 (with the shop name) and the seller type only.
        ...(later ? {} : businessPayload(form)),
      };
      const merchantApplication = await submitMyMerchantOnboarding(
        payload,
        later
          ? {}
          : {
              // A kept document is not sent again.
              rsbsa: keepsDocument("rsbsa") ? null : rsbsaFile,
              govId: keepsDocument("govId") ? null : govIdFile,
              birCert: isRegistered(sellerType) && !keepsDocument("birCert") ? birCertFile : null,
              selfie: keepsDocument("selfie") ? null : selfieFile,
            },
      );
      setSuccessApplication(merchantApplication);
    } catch (error: unknown) {
      if (isPhoneVerificationRequired(error)) {
        setNeedsAccountPhone(true);
        return;
      }
      // The backend names the fields it refused: show them under those fields.
      // A key with no field on the page (e.g. "payload") goes to the banner instead.
      const shown: FieldErrors<FieldKey> = {};
      const unplaced: string[] = [];
      for (const [key, message] of Object.entries(getApiFieldErrors(error))) {
        const field = SERVER_FIELD_ALIASES[key] ?? key;
        if (SHOWN_FIELDS.has(field)) shown[field as FieldKey] ??= message;
        else unplaced.push(message);
      }
      const fields = Object.keys(shown);
      if (unplaced.length) setError(unplaced.join(" "));
      if (fields.length) {
        // The earliest step with a problem; later steps keep theirs (goNext).
        const target = STEPS.findIndex((s) => fields.some((f) => stepOfField(f) === s.id));
        if (target !== -1) setStepIndex(target);
        showFieldErrors(shown);
      }
      if (fields.length || unplaced.length) return;
      const message = errorHelper(error) ?? "Unable to submit your merchant application right now. Please try again.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (successApplication) {
    const saved = successApplication.status === "pending_documents";
    return (
      <div className={styles.page}>
        <section className={styles.card}>
          <h1 className={styles.title}>{saved ? "Application saved" : "Application submitted"}</h1>
          <p className={styles.subtitle}>
            {saved
              ? "Your Merchant Centre is ready: set up your shop and add produce now. Finish your business information when you have your documents; your shop goes live once Carabao approves them."
              : "Your application is now set for review. Meanwhile, set up your shop and add produce in the Merchant Centre; you can publish once it is approved."}
          </p>
          <div className={styles.successBox}>
            <div>
              <div className={styles.successLabel}>{saved ? "Status" : "Merchant"}</div>
              <div className={styles.successValue}>
                {saved ? "Business information to follow" : successApplication.merchant_name}
              </div>
            </div>
            <div className={styles.successActions}>
              <button className={styles.secondaryBtn} type="button" onClick={() => window.location.assign(merchantUrl(MERCHANT_PAGES.dashboard))}>Go to Merchant Centre</button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const govIdLabel = sellerType === "corporation" ? "Authorized representative's government ID" : "Government ID";
  const nameHelp = "Your full legal name as written on your government-issued ID.";
  const sexBirthHelp = "Your full legal name, sex and birth date as written on your government-issued ID.";

  const personFields = (prefix: "" | "rep_", heading?: string) => {
    const key = <K extends "last_name" | "first_name" | "middle_name" | "suffix">(k: K) =>
      `${prefix}${k}` as `${typeof prefix}${K}`;
    const idOf = (k: string) => `merchantonboarding-${prefix}${k}`.replace(/_/g, "-");
    const suffixKey = key("suffix");
    return (
      <>
        {heading && <h3 className={styles.sectionTitle}>{heading}</h3>}
        <TextField id={idOf("last_name")} label="Last name" value={form[key("last_name")]} max={PERSON_MAX} onChange={setText(key("last_name"))} error={fieldErrors[key("last_name")]} placeholder="Dela Cruz" />
        <TextField id={idOf("first_name")} label="First name" value={form[key("first_name")]} max={PERSON_MAX} onChange={setText(key("first_name"))} error={fieldErrors[key("first_name")]} placeholder="Juan" />
        <TextField id={idOf("middle_name")} label="Middle name (optional)" value={form[key("middle_name")]} max={PERSON_MAX} onChange={setText(key("middle_name"))} error={fieldErrors[key("middle_name")]} placeholder="Santos" />
        <div className={`${styles.field}${invalidClass(fieldErrors[suffixKey])}`}>
          <label htmlFor={idOf("suffix")} className={styles.label}>Suffix (optional)</label>
          <select {...invalidProps(idOf("suffix"), fieldErrors[suffixKey])} id={idOf("suffix")} className={styles.select} value={form[suffixKey]} onChange={setField(suffixKey)}>
            <option value="">None</option>
            {NAME_SUFFIXES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <FieldError id={idOf("suffix")} message={fieldErrors[suffixKey]} />
        </div>
        {prefix === "" && (
          <>
            <div className={`${styles.field}${invalidClass(fieldErrors.sex)}`}>
              <label htmlFor={idOf("sex")} className={styles.label}>Sex</label>
              <select {...invalidProps(idOf("sex"), fieldErrors.sex)} id={idOf("sex")} className={styles.select} value={form.sex} onChange={setField("sex")}>
                <option value="">Select</option>
                {SEXES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <FieldError id={idOf("sex")} message={fieldErrors.sex} />
            </div>
            <div className={`${styles.field}${invalidClass(fieldErrors.birth_date)}`}>
              <label htmlFor={idOf("birth_date")} className={styles.label}>Birth date</label>
              <input {...invalidProps(idOf("birth_date"), fieldErrors.birth_date)} id={idOf("birth_date")} type="date" className={styles.input} value={form.birth_date} max={latestBirthDate()} onChange={setField("birth_date")} />
              <FieldError id={idOf("birth_date")} message={fieldErrors.birth_date} />
            </div>
          </>
        )}
        <p className={`${styles.helper} ${styles.fieldFull}`}>{prefix === "" ? sexBirthHelp : nameHelp}</p>
      </>
    );
  };

  return (
    <div className={styles.page}>
      <section className={styles.card}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Apply as a Merchant</h1>
            <p className={styles.subtitle}>A short onboarding to verify your contact details and documents.</p>
          </div>
          <div className={styles.progress}>
            <span className={styles.progressPill}>{`${stepIndex + 1} / ${STEPS.length}`}</span>
          </div>
        </header>

        <nav className={styles.stepper} aria-label="Onboarding steps">
          {STEPS.map((s, idx) => {
            const state = idx === stepIndex ? "active" : idx < stepIndex ? "done" : "todo";
            return (
              <div key={s.id} className={`${styles.step} ${styles[`step_${state}`]}`}>
                <div className={styles.stepDot} aria-hidden="true" />
                <div className={styles.stepText}>
                  <div className={styles.stepTitle}>{s.title}</div>
                  <div className={styles.stepSubtitle}>{s.subtitle}</div>
                </div>
              </div>
            );
          })}
        </nav>

        <div className={styles.body}>
          {(clarifying || application?.status === "rejected") && (
            <div className={styles.reviewNote} role="note">
              <strong className={styles.reviewNoteTitle}>
                {clarifying ? "Carabao asked for changes" : "Your application was not approved"}
              </strong>
              {application?.admin_note && <p className={styles.reviewNoteText}>{application.admin_note}</p>}
              <p className={styles.reviewNoteText}>
                {clarifying
                  ? flags
                    ? `Change these sections: ${CLARIFICATION_SECTIONS.filter((s) => flags.has(s.id))
                        .map((s) => s.label.toLowerCase())
                        .join("; ")}. The other sections and your documents stay as you sent them.`
                    : "Correct your application and send it again."
                  : "Start a new application below. Your contact email and number are already verified, so they need no new code."}
              </p>
            </div>
          )}

          {step.id === "ops" && (
            <div className={styles.grid}>
              <SectionLock open={isOpen("store")} flagged={flags !== null}>
              <TextField
                id="merchantonboarding-merchant-name"
                label="Merchant name"
                value={form.merchant_name}
                max={NAME_MAX}
                onChange={setText("merchant_name")}
                error={fieldErrors.merchant_name}
                placeholder="Carabao Fresh Farm"
                help="The store name buyers see. Your Merchant Centre opens as soon as you save this step."
                full
              />
              </SectionLock>

              <SectionLock open={isOpen("location")} flagged={flags !== null}>
              <LocationSelects
                value={{
                  region: form.region,
                  province: form.province,
                  city: form.city,
                  barangay: form.barangay,
                }}
                onChange={(location) => {
                  setForm((previous) => ({ ...previous, ...location }));
                  clearErrors("region", "province", "city", "barangay");
                }}
                errors={{
                  region: fieldErrors.region,
                  province: fieldErrors.province,
                  city: fieldErrors.city,
                  barangay: fieldErrors.barangay,
                }}
                selectClassName={styles.select}
                labelClassName={styles.label}
                wrapClassName={styles.field}
              />

              <div className={`${styles.field}${invalidClass(fieldErrors.postal_code)}`}>
                <label htmlFor="merchantonboarding-postal-code" className={styles.label}>Postal code</label>
                <input id="merchantonboarding-postal-code" className={styles.input} value={form.postal_code ?? ""} onChange={setField("postal_code")} placeholder="1634" {...invalidProps("merchantonboarding-postal-code", fieldErrors.postal_code)} />
                <FieldError id="merchantonboarding-postal-code" message={fieldErrors.postal_code} />
              </div>

              <div className={`${styles.field} ${styles.fieldFull}${invalidClass(fieldErrors.address)}`}>
                <label htmlFor="merchantonboarding-address" className={styles.label}>Street / House No.</label>
                <input id="merchantonboarding-address" className={styles.input} value={form.address} onChange={setField("address")} placeholder="123 Rizal Ave, Unit 4B" {...invalidProps("merchantonboarding-address", fieldErrors.address)} />
                <FieldError id="merchantonboarding-address" message={fieldErrors.address} />
              </div>

              {/* Farm pickup point (U1c): deliveries start from this pin. */}
              <div className={`${styles.field} ${styles.fieldFull}`}>
                {isOpen("location") ? (
                  <MapPinPicker
                    value={form.lat != null && form.lng != null ? { lat: form.lat, lng: form.lng } : null}
                    confirmed={form.pin_confirmed}
                    strict
                    onChange={(pin, confirmed) => {
                      setForm((prev) => ({ ...prev, lat: pin.lat, lng: pin.lng, pin_confirmed: confirmed }));
                      if (confirmed) clearErrors("pin");
                    }}
                    error={fieldErrors.pin}
                    address={{ street: form.address, postalCode: form.postal_code ?? "", province: form.province, city: form.city, barangay: form.barangay }}
                  />
                ) : (
                  <p className={styles.helper}>Map pin: kept as you placed it.</p>
                )}
              </div>

              <div className={`${styles.field} ${styles.fieldFull}${invalidClass(fieldErrors.available_days)}`}>
                <label className={styles.label}>Available days</label>
                <div className={styles.days} role="group" aria-label="Available days" {...invalidProps("merchantonboarding-days", fieldErrors.available_days)}>
                  {DAYS.map((d) => {
                    const checked = form.available_days.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        className={`${styles.dayChip} ${checked ? styles.dayChipActive : ""}`}
                        onClick={() => toggleDay(d)}
                        aria-pressed={checked}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
                <FieldError id="merchantonboarding-days" message={fieldErrors.available_days} />
              </div>
              </SectionLock>

              <SectionLock open={isOpen("contact")} flagged={flags !== null}>
              <div className={`${styles.field} ${styles.fieldFull}${invalidClass(fieldErrors.contact_email)}`}>
                <label htmlFor="merchantonboarding-contact-email" className={styles.label}>Contact email</label>
                <input
                  id="merchantonboarding-contact-email"
                  className={styles.input}
                  type="email"
                  value={form.contact_email}
                  onChange={handleEmail}
                  placeholder="you@farm.com"
                  disabled={isSubmitting}
                  {...invalidProps("merchantonboarding-contact-email", fieldErrors.contact_email)}
                />
                <FieldError id="merchantonboarding-contact-email" message={fieldErrors.contact_email} />
                <ContactCodeField
                  channel="email"
                  value={normalizeEmail(form.contact_email)}
                  verified={emailVerified}
                  accountNote={
                    isAccountEmail
                      ? "This is your account's verified email, so there's no code to enter."
                      : isKnownEmail
                        ? "You verified this email before, so there's no code to enter."
                        : undefined
                  }
                  disabled={isSubmitting}
                  validate={validateEmail}
                  onSend={sendEmail}
                  onVerify={verifyEmail}
                />
              </div>

              <div className={`${styles.field} ${styles.fieldFull}${invalidClass(fieldErrors.contact_number)}`}>
                <label htmlFor="merchantonboarding-contact-number" className={styles.label}>Contact number</label>
                <div className={styles.phoneRow}>
                  <span className={styles.phonePrefix}>+63</span>
                  <input
                    id="merchantonboarding-contact-number"
                    className={styles.phoneInput}
                    value={form.contact_number}
                    onChange={handlePhone}
                    placeholder="912 345 6789"
                    inputMode="numeric"
                    maxLength={12}
                    disabled={isSubmitting}
                    {...invalidProps("merchantonboarding-contact-number", fieldErrors.contact_number)}
                  />
                </div>
                <FieldError id="merchantonboarding-contact-number" message={fieldErrors.contact_number} />
                <ContactCodeField
                  channel="number"
                  value={form.contact_number}
                  verified={phoneVerified}
                  accountNote={
                    isAccountPhone
                      ? "This is your account's verified number, so there's no code to enter."
                      : isKnownPhone
                        ? "You verified this number before, so there's no code to enter."
                        : undefined
                  }
                  disabled={isSubmitting}
                  validate={validatePhone}
                  onSend={sendPhone}
                  onVerify={verifyPhone}
                />
              </div>
              </SectionLock>
            </div>
          )}

          {step.id === "legal" && (
            <div className={styles.grid}>
              {/* A clarification is answered with Submit now (backend refuses later). */}
              {!clarifying && (
                <RadioGroup<SubmitMode>
                  id="merchantonboarding-submit-mode"
                  legend="Submit business information?"
                  options={[
                    { value: "now", label: "Submit now" },
                    { value: "later", label: "Submit later" },
                  ]}
                  value={form.submit_mode}
                  onChange={(v) => setValue("submit_mode", v)}
                  error={fieldErrors.submit_mode}
                  help={SUBMIT_LATER_HELP}
                  disabled={isSubmitting}
                />
              )}

              <SectionLock open={isOpen("business")} flagged={flags !== null}>
              <RadioGroup<SellerType>
                id="merchantonboarding-seller-type"
                legend="Seller type"
                options={SELLER_OPTIONS}
                value={sellerType}
                onChange={(v) => setValue("seller_type", v)}
                error={fieldErrors.seller_type}
                stacked
                disabled={isSubmitting}
              />
              </SectionLock>

              {!later && sellerType && (
                <>
                  <SectionLock open={isOpen("business")} flagged={false}>
                  <h3 className={styles.sectionTitle}>Legal name</h3>
                  {isIndividual(sellerType) && personFields("")}

                  {(sellerType === "corporation" || sellerType === "cooperative") && (
                    <TextField
                      id="merchantonboarding-company-name"
                      label={sellerType === "cooperative" ? "Cooperative registered name" : "Company registered name"}
                      value={form.company_name}
                      max={COMPANY_MAX}
                      onChange={setText("company_name")}
                      error={fieldErrors.company_name}
                      placeholder={sellerType === "cooperative" ? "Malolos Farmers Multi-Purpose Cooperative" : "Carabao Agri Trading Corp."}
                      full
                    />
                  )}
                  {sellerType !== "individual_farmer" && (
                    <TextField
                      id="merchantonboarding-trade-name"
                      label={sellerType === "cooperative" ? "Business / trade name (optional)" : "Business / trade name"}
                      value={form.trade_name}
                      max={COMPANY_MAX}
                      onChange={setText("trade_name")}
                      error={fieldErrors.trade_name}
                      placeholder="Carabao Fresh"
                      full
                    />
                  )}
                  {sellerType === "corporation" && personFields("rep_", "Authorized representative")}

                  {registration && (
                    <TextField
                      id="merchantonboarding-registration-number"
                      label={`${registration.agency} registration number`}
                      value={form.registration_number}
                      max={30}
                      counter={false}
                      onChange={(v) => setValue("registration_number", formatRegNum(v))}
                      error={fieldErrors.registration_number}
                      placeholder={registration.placeholder}
                      help={registration.hint}
                      full
                    />
                  )}

                  <h3 className={styles.sectionTitle}>Tax information</h3>
                  <TextField
                    id="merchantonboarding-tin"
                    label={isRegistered(sellerType) ? "TIN" : "TIN (optional)"}
                    value={form.tin}
                    max={18}
                    counter={false}
                    inputMode="numeric"
                    onChange={(v) => setValue("tin", formatTIN(v))}
                    error={fieldErrors.tin}
                    placeholder="999-999-999-000"
                    help={
                      isRegistered(sellerType)
                        ? "9 digits plus your branch code. Use 000 if there is no branch."
                        : "You can add this later. If you enter it: 9 digits plus the branch code (000 if there is no branch)."
                    }
                    full
                  />
                  {isRegistered(sellerType) && (
                    <RadioGroup<VatStatus>
                      id="merchantonboarding-vat-status"
                      legend="VAT registration status"
                      options={[
                        { value: "vat_registered", label: "VAT-registered" },
                        { value: "non_vat", label: "Non-VAT" },
                      ]}
                      value={form.vat_status}
                      onChange={(v) => setValue("vat_status", v)}
                      error={fieldErrors.vat_status}
                      disabled={isSubmitting}
                    />
                  )}
                  {isIndividual(sellerType) && (
                    <RadioGroup<boolean>
                      id="merchantonboarding-small-agri-producer"
                      legend="Declare as small agricultural producer"
                      options={[
                        { value: true, label: "Yes" },
                        { value: false, label: "No" },
                      ]}
                      value={form.small_agri_producer}
                      onChange={(v) => setValue("small_agri_producer", v)}
                      error={fieldErrors.small_agri_producer}
                      help={SMALL_PRODUCER_HELP}
                      disabled={isSubmitting}
                    />
                  )}
                  </SectionLock>

                  <SectionLock open={isOpen("documents")} flagged={flags !== null}>
                  <h3 className={styles.sectionTitle}>Documents</h3>
                  <div className={`${styles.fieldFull} ${styles.docsIntro}`}>
                    <p className={styles.docsText}>
                      Upload a clear photo or a PDF scan of your Philippine RSBSA document and of one valid government ID
                      {sellerType === "corporation" ? " of your authorized representative" : ""}.
                    </p>
                  </div>

                  <div className={`${styles.field}${invalidClass(fieldErrors.rsbsa_number)}`}>
                    <label htmlFor="merchantonboarding-rsbsa-number" className={styles.label}>RSBSA number (optional)</label>
                    <input {...invalidProps("merchantonboarding-rsbsa-number", fieldErrors.rsbsa_number)} id="merchantonboarding-rsbsa-number"
                      className={styles.input}
                      value={form.rsbsa_number}
                      onChange={(e) => setValue("rsbsa_number", formatRSBSA(e.target.value))}
                      placeholder="RSBSA-XXXX-XXXX"
                      maxLength={24}
                    />
                    <FieldError id="merchantonboarding-rsbsa-number" message={fieldErrors.rsbsa_number} />
                  </div>
                  <div className={`${styles.field}${invalidClass(fieldErrors.gov_id_type)}`}>
                    <label htmlFor="merchantonboarding-gov-id-type" className={styles.label}>{govIdLabel} type</label>
                    <select {...invalidProps("merchantonboarding-gov-id-type", fieldErrors.gov_id_type)} id="merchantonboarding-gov-id-type" className={styles.select} value={form.gov_id_type} onChange={setField("gov_id_type")}>
                      {GOV_ID_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <FieldError id="merchantonboarding-gov-id-type" message={fieldErrors.gov_id_type} />
                  </div>

                  </SectionLock>

                  {/* Outside the lock: a document with no saved file is needed even when not flagged. */}
                  <div className={`${styles.field}${invalidClass(fieldErrors.rsbsa_file)}`}>
                    <span className={styles.label}>RSBSA document (photo or PDF)</span>
                    {keepsDocument("rsbsa") ? (
                      <p className={styles.helper}>Kept as sent: {storedDocument.rsbsa}</p>
                    ) : (
                      <DocumentDropzone label="RSBSA document" file={rsbsaFile} onChange={(f) => { setRsbsaFile(f); clearErrors("rsbsa_file"); }} />
                    )}
                    <FieldError id="merchantonboarding-rsbsa-file" message={fieldErrors.rsbsa_file} />
                  </div>
                  <div className={`${styles.field}${invalidClass(fieldErrors.gov_id_file)}`}>
                    <span className={styles.label}>{govIdLabel} (photo or PDF)</span>
                    {keepsDocument("govId") ? (
                      <p className={styles.helper}>Kept as sent: {storedDocument.govId}</p>
                    ) : (
                      <DocumentDropzone label="government ID" file={govIdFile} onChange={(f) => { setGovIdFile(f); clearErrors("gov_id_file"); }} />
                    )}
                    <FieldError id="merchantonboarding-gov-id-file" message={fieldErrors.gov_id_file} />
                  </div>
                  {isRegistered(sellerType) && (
                    <div className={`${styles.field} ${styles.fieldFull}${invalidClass(fieldErrors.bir_cert_file)}`}>
                      <span className={styles.label}>BIR Certificate of Registration (Form 2303)</span>
                      {keepsDocument("birCert") ? (
                        <p className={styles.helper}>Kept as sent: {storedDocument.birCert}</p>
                      ) : (
                        <DocumentDropzone label="BIR Certificate of Registration" file={birCertFile} onChange={(f) => { setBirCertFile(f); clearErrors("bir_cert_file"); }} />
                      )}
                      <FieldError id="merchantonboarding-bir-cert-file" message={fieldErrors.bir_cert_file} />
                    </div>
                  )}

                  <div className={`${styles.field} ${styles.fieldFull}${invalidClass(fieldErrors.selfie_file)}`}>
                    <span className={styles.label}>
                      {sellerType === "corporation"
                        ? "Selfie of the authorized representative with their government ID"
                        : "Selfie with your government ID"}
                    </span>
                    {keepsDocument("selfie") ? (
                      <p className={styles.helper}>Kept as sent.</p>
                    ) : (
                      <>
                        <p className={styles.helper}>
                          Take a photo of yourself while you hold the ID that you uploaded. Our team compares your face with
                          the photo on the ID. Use the camera on this device; you cannot upload a saved photo.
                        </p>
                        <SelfieCapture file={selfieFile} onChange={(f) => { setSelfieFile(f); clearErrors("selfie_file"); }} />
                      </>
                    )}
                    <FieldError id="merchantonboarding-selfie-file" message={fieldErrors.selfie_file} />
                  </div>

                  <div className={`${styles.field} ${styles.fieldFull}${invalidClass(fieldErrors.terms_accepted)}`}>
                    <label className={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={form.terms_accepted}
                        onChange={(e) => setValue("terms_accepted", e.target.checked)}
                        {...invalidProps("merchantonboarding-terms", fieldErrors.terms_accepted)}
                      />
                      <span>
                        I agree to the{" "}
                        <a href={helpUrl("/terms")} target="_blank" rel="noopener">Terms of Service</a>{" "}
                        and the{" "}
                        <a href={helpUrl("/privacy")} target="_blank" rel="noopener">Data Privacy Policy</a>.
                        {" "}I agree that my RSBSA document, government ID, and BIR Form 2303 are sent to
                        Google Cloud Vision to read the text on them for the review of this application.
                      </span>
                    </label>
                    <FieldError id="merchantonboarding-terms" message={fieldErrors.terms_accepted} />
                  </div>
                </>
              )}
            </div>
          )}

          {error && <div className={styles.errorBox} role="alert">{error}</div>}
        </div>

        <footer className={styles.footer}>
          <button
            className={styles.secondaryBtn}
            type="button"
            onClick={goBack}
            disabled={stepIndex === 0 || isSubmitting}
          >
            Back
          </button>
          {stepIndex < STEPS.length - 1 ? (
            <button
              className={styles.primaryBtn}
              type="button"
              onClick={goNext}
              disabled={isSubmitting}
            >
              Continue
            </button>
          ) : (
            <button className={styles.primaryBtn} type="button" onClick={submit} disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : later ? "Save and finish later" : "Submit"}
            </button>
          )}
        </footer>
      </section>

      {needsAccountPhone && (
        <PhoneVerifyDialog
          reason="Merchant accounts need a verified mobile number."
          initialNumber={normalizePhMobile(fullPhoneNumber)}
          onClose={() => setNeedsAccountPhone(false)}
          onVerified={(phone) => {
            setNeedsAccountPhone(false);
            setAccountPhone(phone);
            void submit();
          }}
        />
      )}
    </div>
  );
}
