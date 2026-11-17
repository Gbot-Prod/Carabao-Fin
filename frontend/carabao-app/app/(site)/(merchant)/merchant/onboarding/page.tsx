"use client";

import errorHelper, { isPhoneVerificationRequired } from "@/util/errorHelper";
import PhoneVerifyDialog from "@/components/PhoneVerifyDialog/PhoneVerifyDialog";
import { displayEmail, normalizePhMobile } from "@/lib/phone";
import { sendPhoneCode, verifyMyPhone } from "@/lib/auth-client";

import { useEffect, useState } from "react";
import { appUrl } from "@/lib/urls";
import styles from "./page.module.css";
import LocationSelects from "@/components/LocationSelects/LocationSelects";
import MapPinPicker from "@/components/MapPinPicker/MapPinPicker";
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
  const [error, setError] = useState<string | null>(null);
  const [successApplication, setSuccessApplication] = useState<MerchantApplication | null>(null);

  // The account's own verified number and email need no second code.
  // Applying needs a verified account number at all (backend require_verified_phone).
  const [accountPhone, setAccountPhone] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [needsAccountPhone, setNeedsAccountPhone] = useState(false);
  // Tokens from /sms/otp/verify and /email/otp/verify. A changed value clears its token.
  const [phoneVerificationToken, setPhoneVerificationToken] = useState<string | null>(null);
  const [emailVerificationToken, setEmailVerificationToken] = useState<string | null>(null);

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
      };

  const handleTIN = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, tin: formatTIN(e.target.value) }));

  // A new number or email is unverified again and needs a new code.
  const handlePhone = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = formatLocalPhone(e.target.value);
    if (next === form.contact_number) return;
    setForm((prev) => ({ ...prev, contact_number: next }));
    setPhoneVerificationToken(null);
  };

  const handleEmail = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    if (normalizeEmail(next) !== normalizeEmail(form.contact_email)) setEmailVerificationToken(null);
    setForm((prev) => ({ ...prev, contact_email: next }));
  };

  const handleRegNum = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, registration_number: formatRegNum(e.target.value) }));

  const handleRSBSA = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, rsbsa_number: formatRSBSA(e.target.value) }));

  const toggleDay = (day: (typeof DAYS)[number]) => {
    setForm((prev) => {
      const set = new Set(prev.available_days);
      if (set.has(day)) set.delete(day);
      else set.add(day);
      return { ...prev, available_days: Array.from(set) };
    });
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
      return;
    }
    setPhoneVerificationToken(await verifyOtp(fullPhoneNumber, code));
  };
  const sendEmail = () => sendEmailOtp(form.contact_email.trim());
  const verifyEmail = async (code: string) => {
    setEmailVerificationToken(await verifyEmailOtp(form.contact_email.trim(), code));
  };

  const validateStep = (id: StepId): string | null => {
    if (id === "ops") {
      if (!form.address.trim()) return "Address is required.";
      if (!Array.isArray(form.available_days) || form.available_days.length === 0) return "Select at least one available day.";
      if (!form.contact_email.trim()) return "Contact email is required.";
      if (!emailVerified) return "Verify your contact email first.";
      if (!phoneVerified) return "Verify your contact number first.";
      return null;
    }
    if (!form.merchant_name.trim()) return "Merchant name is required.";
    if (!form.legal_business_name.trim()) return "Legal business name is required.";
    if (!form.business_type.trim()) return "Business type is required.";
    return documentError(rsbsaFile, "RSBSA document") ?? documentError(govIdFile, "government ID");
  };

  const goNext = () => {
    setError(null);
    const validationError = validateStep(step.id);
    if (validationError) return setError(validationError);
    setStepIndex((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const goBack = () => {
    setError(null);
    setStepIndex((s) => Math.max(s - 1, 0));
  };

  const submit = async () => {
    setError(null);
    const validationError = validateStep("ops") ?? validateStep("legal");
    if (validationError) return setError(validationError);
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
              <button className={styles.secondaryBtn} type="button" onClick={() => window.location.assign(appUrl("/profile"))}>Back to profile</button>
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
              <div className={`${styles.field} ${styles.fieldFull}`}>
                <label htmlFor="merchantonboarding-address" className={styles.label}>Address</label>
                <input id="merchantonboarding-address" className={styles.input} value={form.address} onChange={setField("address")} placeholder="Street, Barangay" />
              </div>

              <LocationSelects
                value={{
                  region: form.region,
                  province: form.province,
                  city: form.city,
                  barangay: form.barangay,
                }}
                onChange={(location) => setForm((previous) => ({ ...previous, ...location }))}
                selectClassName={styles.select}
                labelClassName={styles.label}
                wrapClassName={styles.field}
              />

              <div className={styles.field}>
                <label htmlFor="merchantonboarding-postal-code" className={styles.label}>Postal code (optional)</label>
                <input id="merchantonboarding-postal-code" className={styles.input} value={form.postal_code ?? ""} onChange={setField("postal_code")} placeholder="1634" />
              </div>

              {/* Farm pickup point (U1c): deliveries start from this pin. */}
              <div className={`${styles.field} ${styles.fieldFull}`}>
                <MapPinPicker
                  value={form.lat != null && form.lng != null ? { lat: form.lat, lng: form.lng } : null}
                  onChange={(pin, found) =>
                    setForm((prev) => ({
                      ...prev,
                      lat: pin.lat,
                      lng: pin.lng,
                      address: prev.address || found?.street || prev.address,
                      postal_code: prev.postal_code || found?.postcode || prev.postal_code,
                    }))
                  }
                />
              </div>

              <div className={`${styles.field} ${styles.fieldFull}`}>
                <label className={styles.label}>Available days</label>
                <div className={styles.days}>
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
              </div>

              <div className={`${styles.field} ${styles.fieldFull}`}>
                <label htmlFor="merchantonboarding-contact-email" className={styles.label}>Contact email</label>
                <input
                  id="merchantonboarding-contact-email"
                  className={styles.input}
                  type="email"
                  value={form.contact_email}
                  onChange={handleEmail}
                  placeholder="you@farm.com"
                  disabled={isSubmitting}
                />
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

              <div className={`${styles.field} ${styles.fieldFull}`}>
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
                  />
                </div>
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
              <div className={styles.field}>
                <label htmlFor="merchantonboarding-merchant-name" className={styles.label}>Merchant name</label>
                <input id="merchantonboarding-merchant-name" className={styles.input} value={form.merchant_name} onChange={setField("merchant_name")} placeholder="Carabao Fresh Farm" />
              </div>
              <div className={styles.field}>
                <label htmlFor="merchantonboarding-legal-business-name" className={styles.label}>Legal business name</label>
                <input id="merchantonboarding-legal-business-name" className={styles.input} value={form.legal_business_name} onChange={setField("legal_business_name")} placeholder="Carabao Fresh Farm Trading" />
              </div>

              <div className={styles.field}>
                <label htmlFor="merchantonboarding-business-type" className={styles.label}>Business type</label>
                <select id="merchantonboarding-business-type" className={styles.select} value={form.business_type} onChange={setField("business_type")}>
                  <option value="Sole Proprietor">Sole Proprietor</option>
                  <option value="Partnership">Partnership</option>
                  <option value="Corporation">Corporation</option>
                  <option value="Cooperative">Cooperative</option>
                  <option value="Farmer">Farmer</option>
                </select>
              </div>
              <div className={styles.field}>
                <label htmlFor="merchantonboarding-tin" className={styles.label}>TIN (optional)</label>
                <input id="merchantonboarding-tin"
                  className={styles.input}
                  value={form.tin ?? ""}
                  onChange={handleTIN}
                  placeholder="123-456-789-000"
                  inputMode="numeric"
                  maxLength={15}
                />
              </div>

              <div className={styles.field}>
                <label htmlFor="merchantonboarding-registration-type" className={styles.label}>Registration type</label>
                <select id="merchantonboarding-registration-type" className={styles.select} value={form.registration_type ?? ""} onChange={setField("registration_type")}>
                  <option value="DTI">DTI</option>
                  <option value="SEC">SEC</option>
                  <option value="CDA">CDA</option>
                  <option value="LGU">LGU / Permit</option>
                  <option value="">None</option>
                </select>
              </div>
              <div className={styles.field}>
                <label htmlFor="merchantonboarding-registration-number" className={styles.label}>Registration number (optional)</label>
                <input id="merchantonboarding-registration-number"
                  className={styles.input}
                  value={form.registration_number ?? ""}
                  onChange={handleRegNum}
                  placeholder="DTI-00000-000000"
                  maxLength={30}
                />
              </div>

              <div className={`${styles.fieldFull} ${styles.docsIntro}`}>
                <p className={styles.docsText}>
                  Upload a clear photo or a PDF scan of your Philippine RSBSA document and of one valid government ID.
                </p>
              </div>

              <div className={styles.field}>
                <label htmlFor="merchantonboarding-rsbsa-number" className={styles.label}>RSBSA number (optional)</label>
                <input id="merchantonboarding-rsbsa-number"
                  className={styles.input}
                  value={form.rsbsa_number ?? ""}
                  onChange={handleRSBSA}
                  placeholder="RSBSA-XXXX-XXXX"
                  maxLength={24}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="merchantonboarding-gov-id-type" className={styles.label}>Government ID type</label>
                <select id="merchantonboarding-gov-id-type" className={styles.select} value={form.gov_id_type} onChange={setField("gov_id_type")}>
                  {GOV_ID_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div className={styles.field}>
                <span className={styles.label}>RSBSA document (photo or PDF)</span>
                <DocumentDropzone label="RSBSA document" file={rsbsaFile} onChange={setRsbsaFile} />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Government ID (photo or PDF)</span>
                <DocumentDropzone label="government ID" file={govIdFile} onChange={setGovIdFile} />
              </div>
            </div>
          )}

          {error && <div className={styles.errorBox}>{error}</div>}
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
              disabled={isSubmitting || !emailVerified || !phoneVerified}
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
