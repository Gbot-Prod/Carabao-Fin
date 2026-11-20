"use client";

import errorHelper, { getApiFieldErrors, isPhoneVerificationRequired } from "@/util/errorHelper";
import FieldError, { FieldErrors, focusFirstInvalid, invalidClass, invalidProps } from "@/components/FieldError/FieldError";
import PhoneVerifyDialog from "@/components/PhoneVerifyDialog/PhoneVerifyDialog";
import { displayEmail, normalizePhMobile } from "@/lib/phone";
import { sendPhoneCode, verifyMyPhone } from "@/lib/auth-client";

import { useEffect, useState } from "react";
import { NCR_PROVINCE } from "@/util/serviceArea";
import { MERCHANT_PAGES } from "@/lib/merchant-links";
import { merchantUrl } from "@/lib/urls";
import styles from "./page.module.css";
import LocationSelects from "@/components/LocationSelects/LocationSelects";
import MapPinPicker from "@/components/MapPinPicker/MapPinPicker";
import { usePinAutofill } from "@/components/MapPinPicker/usePinAutofill";
import { mergeLocation } from "@/lib/pin-autofill";
import ContactCodeField from "./ContactCodeField";
import DocumentDropzone, { documentError } from "./DocumentDropzone";
import {
  defaultAddress,
  fetchMyProfile,
  submitMyMerchantOnboarding,
  sendOtp,
  verifyOtp,
  sendEmailOtp,
  verifyEmailOtp,
  GOV_ID_TYPES,
  MerchantOnboardingPayload,
  MerchantApplication,
} from "@/util/api";

type StepId = "ops" | "legal";
// Payload fields plus the parts of the form that are not payload fields.
type FieldKey = keyof MerchantOnboardingPayload | "pin" | "rsbsa_file" | "gov_id_file";

const OPS_FIELDS = new Set<string>([
  "address", "region", "province", "city", "barangay", "postal_code", "pin", "lat", "lng",
  "available_days", "contact_email", "contact_number", "email_verification_token", "phone_verification_token",
]);
const stepOfField = (field: string): StepId => (OPS_FIELDS.has(field) ? "ops" : "legal");
// Server keys with no message slot of their own, shown under the field they belong to.
const SERVER_FIELD_ALIASES: Record<string, FieldKey> = {
  email_verification_token: "contact_email",
  phone_verification_token: "contact_number",
  lat: "pin",
  lng: "pin",
};
// Fields that show a message under themselves (keep in step with the JSX below).
const SHOWN_FIELDS = new Set<string>([
  "address", "available_days", "barangay", "business_type", "city", "contact_email", "contact_number",
  "gov_id_file", "gov_id_type", "legal_business_name", "merchant_name", "pin", "postal_code", "province",
  "region", "registration_number", "registration_type", "rsbsa_file", "rsbsa_number", "tin",
]);
// NCR has no provinces; the payload still needs one (backend requires it).
const isNcrRegion = (region: string) => /\b(ncr|national capital|metro manila)\b/i.test(region);
// Merchant and legal business name limit (backend MERCHANT_NAME_MAX).
const NAME_MAX = 50;

const STEPS: { id: StepId; title: string; subtitle: string }[] = [
  { id: "ops", title: "Operations & Contact", subtitle: "Where you operate, and a verified email and number." },
  { id: "legal", title: "Legal & Documents", subtitle: "Your business details, RSBSA and a government ID." },
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatTIN(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 12);
  const parts: string[] = [];
  for (let i = 0; i < digits.length; i += 3) parts.push(digits.slice(i, i + 3));
  return parts.join("-");
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

export default function MerchantOnboardingPage() {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex] ?? STEPS[0]!;

  const [rsbsaFile, setRsbsaFile] = useState<File | null>(null);
  const [govIdFile, setGovIdFile] = useState<File | null>(null);
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

  const autofill = usePinAutofill();
  const [form, setForm] = useState<MerchantOnboardingPayload>({
    merchant_name: "",
    legal_business_name: "",
    business_type: "Sole Proprietor",
    tin: "",
    registration_type: "DTI",
    registration_number: "",
    contact_email: "",
    contact_number: "",
    region: "",
    province: "",
    city: "",
    barangay: "",
    address: "",
    postal_code: "",
    available_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    rsbsa_number: "",
    gov_id_type: "PhilSys National ID",
  });

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
    };
    void prefill();
  }, []);

  const fullPhoneNumber = `+63${form.contact_number.replace(/\s/g, "")}`;
  const isAccountPhone = accountPhone !== null && normalizePhMobile(fullPhoneNumber) === accountPhone;
  const phoneVerified = isAccountPhone || phoneVerificationToken !== null;
  const isAccountEmail = accountEmail !== null && normalizeEmail(form.contact_email) === accountEmail;
  const emailVerified = isAccountEmail || emailVerificationToken !== null;

  const setField =
    <K extends keyof MerchantOnboardingPayload>(key: K) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const value = e.target.value;
        setForm((prev) => ({ ...prev, [key]: value }) as MerchantOnboardingPayload);
        clearErrors(key);
      };

  const handleTIN = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, tin: formatTIN(e.target.value) }));
    clearErrors("tin");
  };

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

  const handleRegNum = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, registration_number: formatRegNum(e.target.value) }));
    clearErrors("registration_number");
  };

  const handleRSBSA = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, rsbsa_number: formatRSBSA(e.target.value) }));
    clearErrors("rsbsa_number");
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

  // Every problem in a step, keyed by field. Mirrors backend MerchantOnboardingPayload.
  const validateStep = (id: StepId): FieldErrors<FieldKey> => {
    const errors: FieldErrors<FieldKey> = {};
    if (id === "ops") {
      if (!form.address.trim()) errors.address = "Address is required.";
      if (!form.region.trim()) errors.region = "Select your region.";
      else if (!form.province.trim() && !isNcrRegion(form.region)) errors.province = "Select your province.";
      if (form.region.trim() && !form.city?.trim()) errors.city = "Select your city / municipality.";
      if (form.city?.trim() && !form.barangay?.trim()) errors.barangay = "Select your barangay.";
      if (!form.postal_code?.trim()) errors.postal_code = "Postal code is required.";
      if (!Array.isArray(form.available_days) || form.available_days.length === 0)
        errors.available_days = "Select at least one available day.";
      if (!form.contact_email.trim()) errors.contact_email = "Contact email is required.";
      else if (!emailVerified) errors.contact_email = "Verify your contact email first.";
      if (!phoneVerified) errors.contact_number = "Verify your contact number first.";
      return errors;
    }
    const merchantName = form.merchant_name.trim();
    if (!merchantName) errors.merchant_name = "Merchant name is required.";
    else if (merchantName.length < 3) errors.merchant_name = "Merchant name must be at least 3 characters.";
    const legalName = form.legal_business_name.trim();
    if (!legalName) errors.legal_business_name = "Legal business name is required.";
    else if (legalName.length < 3) errors.legal_business_name = "Legal business name must be at least 3 characters.";
    if (!form.business_type.trim()) errors.business_type = "Business type is required.";
    const tin = form.tin?.trim() ?? "";
    if (tin && tin.length < 6) errors.tin = "TIN looks incomplete. Enter the full number (e.g. 123-456-789-000) or leave it blank.";
    const rsbsaError = documentError(rsbsaFile, "RSBSA document");
    if (rsbsaError) errors.rsbsa_file = rsbsaError;
    const govIdError = documentError(govIdFile, "government ID");
    if (govIdError) errors.gov_id_file = govIdError;
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
    if (!rsbsaFile || !govIdFile) return;
    setIsSubmitting(true);
    try {
      const dayOrder = (d: string) => {
        const idx = DAYS.indexOf(d as (typeof DAYS)[number]);
        return idx === -1 ? 999 : idx;
      };
      const merchantApplication = await submitMyMerchantOnboarding(
        {
          ...form,
          province: form.province.trim() || (isNcrRegion(form.region) ? NCR_PROVINCE : ""),
          contact_email: form.contact_email.trim(),
          contact_number: form.contact_number.trim() ? `+63 ${form.contact_number.trim()}` : "",
          available_days: [...form.available_days].sort((a, b) => dayOrder(a) - dayOrder(b)),
          phone_verification_token: isAccountPhone ? "" : phoneVerificationToken ?? "",
          email_verification_token: isAccountEmail ? "" : emailVerificationToken ?? "",
        },
        rsbsaFile,
        govIdFile,
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
    return (
      <div className={styles.page}>
        <section className={styles.card}>
          <h1 className={styles.title}>Application submitted</h1>
          <p className={styles.subtitle}>
            Your application is now set for review. We will notify you via email once your application has been approved or rejected.
          </p>
          <div className={styles.successBox}>
            <div>
              <div className={styles.successLabel}>Merchant</div>
              <div className={styles.successValue}>{successApplication.merchant_name}</div>
            </div>
            <div className={styles.successActions}>
              <button className={styles.secondaryBtn} type="button" onClick={() => window.location.assign(merchantUrl(MERCHANT_PAGES.dashboard))}>Go to Merchant Centre</button>
            </div>
          </div>
        </section>
      </div>
    );
  }

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
          {step.id === "ops" && (
            <div className={styles.grid}>
              <div className={`${styles.field} ${styles.fieldFull}${invalidClass(fieldErrors.address)}`}>
                <label htmlFor="merchantonboarding-address" className={styles.label}>Address</label>
                <input id="merchantonboarding-address" className={styles.input} value={form.address} onChange={setField("address")} placeholder="Street, Barangay" {...invalidProps("merchantonboarding-address", fieldErrors.address)} />
                <FieldError id="merchantonboarding-address" message={fieldErrors.address} />
              </div>

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

              {/* Farm pickup point (U1c): deliveries start from this pin. */}
              <div className={`${styles.field} ${styles.fieldFull}${invalidClass(fieldErrors.pin)}`}>
                <MapPinPicker
                  value={form.lat != null && form.lng != null ? { lat: form.lat, lng: form.lng } : null}
                  onChange={(pin, found) => {
                    setForm((prev) => ({
                      ...prev,
                      ...(found?.location ? mergeLocation(prev, found.location) : {}),
                      lat: pin.lat,
                      lng: pin.lng,
                      address: autofill("address", prev.address, found?.street),
                      postal_code: autofill("postal_code", prev.postal_code ?? "", found?.postcode),
                    }));
                    clearErrors("pin");
                    if (found?.street) clearErrors("address");
                    if (found?.postcode) clearErrors("postal_code");
                    if (found?.location) clearErrors("region", "province", "city", "barangay");
                  }}
                />
                <FieldError id="merchantonboarding-pin" message={fieldErrors.pin} />
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
                  accountNote={isAccountEmail ? "This is your account's verified email, so there's no code to enter." : undefined}
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
                  accountNote={isAccountPhone ? "This is your account's verified number, so there's no code to enter." : undefined}
                  disabled={isSubmitting}
                  validate={validatePhone}
                  onSend={sendPhone}
                  onVerify={verifyPhone}
                />
              </div>
            </div>
          )}

          {step.id === "legal" && (
            <div className={styles.grid}>
              <div className={`${styles.field}${invalidClass(fieldErrors.merchant_name)}`}>
                <div className={styles.labelRow}>
                  <label htmlFor="merchantonboarding-merchant-name" className={styles.label}>Merchant name</label>
                  <span className={styles.charCount} aria-hidden="true">{form.merchant_name.length}/{NAME_MAX}</span>
                </div>
                <input {...invalidProps("merchantonboarding-merchant-name", fieldErrors.merchant_name)} id="merchantonboarding-merchant-name" className={styles.input} maxLength={NAME_MAX} aria-label={`Merchant name, up to ${NAME_MAX} characters`} value={form.merchant_name} onChange={setField("merchant_name")} placeholder="Carabao Fresh Farm" />
                <FieldError id="merchantonboarding-merchant-name" message={fieldErrors.merchant_name} />
              </div>
              <div className={`${styles.field}${invalidClass(fieldErrors.legal_business_name)}`}>
                <div className={styles.labelRow}>
                  <label htmlFor="merchantonboarding-legal-business-name" className={styles.label}>Legal business name</label>
                  <span className={styles.charCount} aria-hidden="true">{form.legal_business_name.length}/{NAME_MAX}</span>
                </div>
                <input {...invalidProps("merchantonboarding-legal-business-name", fieldErrors.legal_business_name)} id="merchantonboarding-legal-business-name" className={styles.input} maxLength={NAME_MAX} aria-label={`Legal business name, up to ${NAME_MAX} characters`} value={form.legal_business_name} onChange={setField("legal_business_name")} placeholder="Carabao Fresh Farm Trading" />
                <FieldError id="merchantonboarding-legal-business-name" message={fieldErrors.legal_business_name} />
              </div>

              <div className={`${styles.field}${invalidClass(fieldErrors.business_type)}`}>
                <label htmlFor="merchantonboarding-business-type" className={styles.label}>Business type</label>
                <select {...invalidProps("merchantonboarding-business-type", fieldErrors.business_type)} id="merchantonboarding-business-type" className={styles.select} value={form.business_type} onChange={setField("business_type")}>
                  <option value="Sole Proprietor">Sole Proprietor</option>
                  <option value="Partnership">Partnership</option>
                  <option value="Corporation">Corporation</option>
                  <option value="Cooperative">Cooperative</option>
                  <option value="Farmer">Farmer</option>
                </select>
                <FieldError id="merchantonboarding-business-type" message={fieldErrors.business_type} />
              </div>
              <div className={`${styles.field}${invalidClass(fieldErrors.tin)}`}>
                <label htmlFor="merchantonboarding-tin" className={styles.label}>TIN (optional)</label>
                <input {...invalidProps("merchantonboarding-tin", fieldErrors.tin)} id="merchantonboarding-tin"
                  className={styles.input}
                  value={form.tin ?? ""}
                  onChange={handleTIN}
                  placeholder="123-456-789-000"
                  inputMode="numeric"
                  maxLength={15}
                />
                <FieldError id="merchantonboarding-tin" message={fieldErrors.tin} />
              </div>

              <div className={`${styles.field}${invalidClass(fieldErrors.registration_type)}`}>
                <label htmlFor="merchantonboarding-registration-type" className={styles.label}>Registration type</label>
                <select {...invalidProps("merchantonboarding-registration-type", fieldErrors.registration_type)} id="merchantonboarding-registration-type" className={styles.select} value={form.registration_type ?? ""} onChange={setField("registration_type")}>
                  <option value="DTI">DTI</option>
                  <option value="SEC">SEC</option>
                  <option value="CDA">CDA</option>
                  <option value="LGU">LGU / Permit</option>
                  <option value="">None</option>
                </select>
                <FieldError id="merchantonboarding-registration-type" message={fieldErrors.registration_type} />
              </div>
              <div className={`${styles.field}${invalidClass(fieldErrors.registration_number)}`}>
                <label htmlFor="merchantonboarding-registration-number" className={styles.label}>Registration number (optional)</label>
                <input {...invalidProps("merchantonboarding-registration-number", fieldErrors.registration_number)} id="merchantonboarding-registration-number"
                  className={styles.input}
                  value={form.registration_number ?? ""}
                  onChange={handleRegNum}
                  placeholder="DTI-00000-000000"
                  maxLength={30}
                />
                <FieldError id="merchantonboarding-registration-number" message={fieldErrors.registration_number} />
              </div>

              <div className={`${styles.fieldFull} ${styles.docsIntro}`}>
                <p className={styles.docsText}>
                  Upload a clear photo or a PDF scan of your Philippine RSBSA document and of one valid government ID.
                </p>
              </div>

              <div className={`${styles.field}${invalidClass(fieldErrors.rsbsa_number)}`}>
                <label htmlFor="merchantonboarding-rsbsa-number" className={styles.label}>RSBSA number (optional)</label>
                <input {...invalidProps("merchantonboarding-rsbsa-number", fieldErrors.rsbsa_number)} id="merchantonboarding-rsbsa-number"
                  className={styles.input}
                  value={form.rsbsa_number ?? ""}
                  onChange={handleRSBSA}
                  placeholder="RSBSA-XXXX-XXXX"
                  maxLength={24}
                />
                <FieldError id="merchantonboarding-rsbsa-number" message={fieldErrors.rsbsa_number} />
              </div>
              <div className={`${styles.field}${invalidClass(fieldErrors.gov_id_type)}`}>
                <label htmlFor="merchantonboarding-gov-id-type" className={styles.label}>Government ID type</label>
                <select {...invalidProps("merchantonboarding-gov-id-type", fieldErrors.gov_id_type)} id="merchantonboarding-gov-id-type" className={styles.select} value={form.gov_id_type} onChange={setField("gov_id_type")}>
                  {GOV_ID_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <FieldError id="merchantonboarding-gov-id-type" message={fieldErrors.gov_id_type} />
              </div>

              <div className={`${styles.field}${invalidClass(fieldErrors.rsbsa_file)}`}>
                <span className={styles.label}>RSBSA document (photo or PDF)</span>
                <DocumentDropzone label="RSBSA document" file={rsbsaFile} onChange={(f) => { setRsbsaFile(f); clearErrors("rsbsa_file"); }} />
                <FieldError id="merchantonboarding-rsbsa-file" message={fieldErrors.rsbsa_file} />
              </div>
              <div className={`${styles.field}${invalidClass(fieldErrors.gov_id_file)}`}>
                <span className={styles.label}>Government ID (photo or PDF)</span>
                <DocumentDropzone label="government ID" file={govIdFile} onChange={(f) => { setGovIdFile(f); clearErrors("gov_id_file"); }} />
                <FieldError id="merchantonboarding-gov-id-file" message={fieldErrors.gov_id_file} />
              </div>
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
              {isSubmitting ? "Submitting…" : "Submit"}
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
