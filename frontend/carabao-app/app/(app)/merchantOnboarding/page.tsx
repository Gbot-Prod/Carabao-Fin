"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import LocationSelects from "@/components/LocationSelects/LocationSelects";
import {
  fetchMyProfile,
  submitMyMerchantOnboarding,
  sendOtp,
  verifyOtp,
  type Merchant,
  type MerchantOnboardingPayload,
} from "@/util/api";

type StepId = "legal" | "ops" | "docs" | "verify";

const STEPS: { id: StepId; title: string; subtitle: string }[] = [
  { id: "legal", title: "Legal Details", subtitle: "Tell us who you are as a business." },
  { id: "ops", title: "Operations", subtitle: "Where you operate, your pricing, and availability." },
  { id: "docs", title: "RSBSA Upload", subtitle: "Upload a photo or PDF of your Philippine RSBSA." },
  { id: "verify", title: "Verify Phone", subtitle: "Confirm your contact number via SMS." },
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

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

export default function MerchantOnboardingPage() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex] ?? STEPS[0]!;

  const [rsbsaFile, setRsbsaFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMerchant, setSuccessMerchant] = useState<Merchant | null>(null);

  // OTP state
  const [otpSent, setOtpSent] = useState(false);
  const [otpValue, setOtpValue] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  const [form, setForm] = useState<MerchantOnboardingPayload>({
    merchant_name: "",
    legal_business_name: "",
    business_type: "Sole Proprietor",
    tin: "",
    registration_type: "DTI",
    registration_number: "",
    contact_email: "",
    contact_number: "",
    address_line: "",
    city: "",
    province: "",
    region: "",
    postal_code: "",
    price_range_min: 0,
    price_range_max: 0,
    available_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    rsbsa_number: "",
  });

  useEffect(() => {
    const prefill = async () => {
      try {
        const p = await fetchMyProfile();
        setForm((prev) => ({
          ...prev,
          contact_email: prev.contact_email || p.email || "",
          contact_number: prev.contact_number || (p.phone_number?.replace(/^\+63\s?/, "") ?? ""),
          address_line: prev.address_line || (p.address ?? ""),
          city: prev.city || (p.city ?? ""),
          province: prev.province || (p.country ?? ""),
          postal_code: prev.postal_code || (p.postal_code ?? ""),
        }));
      } catch {
        // No prefill on error.
      }
    };
    void prefill();
  }, []);

  // Resend cooldown countdown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const progressLabel = useMemo(() => `${stepIndex + 1} / ${STEPS.length}`, [stepIndex]);

  const fullPhoneNumber = `+63${form.contact_number.replace(/\s/g, "")}`;

  const setField =
    <K extends keyof MerchantOnboardingPayload>(key: K) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const value = e.target.value;
        setForm((prev) => {
          if (key === "price_range_min" || key === "price_range_max") {
            const num = Number(value);
            return { ...prev, [key]: Number.isFinite(num) ? num : 0 } as MerchantOnboardingPayload;
          }
          return { ...prev, [key]: value } as MerchantOnboardingPayload;
        });
      };

  const handleTIN = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, tin: formatTIN(e.target.value) }));

  const handlePhone = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, contact_number: formatLocalPhone(e.target.value) }));

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

  const validateStep = (index: number): string | null => {
    if (index === 0) {
      if (!form.merchant_name.trim()) return "Merchant name is required.";
      if (!form.legal_business_name.trim()) return "Legal business name is required.";
      if (!form.business_type.trim()) return "Business type is required.";
      if (!form.contact_email.trim()) return "Email is required.";
      if (!form.contact_number.trim()) return "Contact number is required.";
      return null;
    }
    if (index === 1) {
      if (!form.address_line.trim()) return "Address is required.";
      if (!form.city.trim()) return "City / Municipality is required.";
      if (!Array.isArray(form.available_days) || form.available_days.length === 0) return "Select at least one available day.";
      if (!Number.isFinite(form.price_range_min) || form.price_range_min < 0) return "Minimum price must be 0 or higher.";
      if (!Number.isFinite(form.price_range_max) || form.price_range_max < 0) return "Maximum price must be 0 or higher.";
      if (form.price_range_min > form.price_range_max) return "Minimum price must be less than or equal to maximum price.";
      return null;
    }
    if (index === 2) {
      if (!rsbsaFile) return "Please upload your RSBSA document (photo or PDF).";
      const okType = ["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(rsbsaFile.type);
      if (!okType) return "RSBSA file must be a PDF or an image (PNG/JPG/WEBP).";
      if (rsbsaFile.size > 10 * 1024 * 1024) return "RSBSA file must be 10MB or smaller.";
      return null;
    }
    return null;
  };

  const goNext = () => {
    setError(null);
    const validationError = validateStep(stepIndex);
    if (validationError) return setError(validationError);
    setStepIndex((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const goBack = () => {
    setError(null);
    setOtpError(null);
    if (stepIndex === STEPS.length - 1) {
      setOtpSent(false);
      setOtpValue("");
    }
    setStepIndex((s) => Math.max(s - 1, 0));
  };

  const handleSendOtp = async () => {
    setIsSendingOtp(true);
    setOtpError(null);
    try {
      await sendOtp(fullPhoneNumber);
      setOtpSent(true);
      setResendCooldown(30);
    } catch (e: any) {
      setOtpError(
        e?.response?.data?.detail || "Failed to send verification code. Please try again.",
      );
    } finally {
      setIsSendingOtp(false);
    }
  };

  const submit = async () => {
    setError(null);
    if (!rsbsaFile) return;
    setIsSubmitting(true);
    try {
      const dayOrder = (d: string) => {
        const idx = DAYS.indexOf(d as (typeof DAYS)[number]);
        return idx === -1 ? 999 : idx;
      };
      const merchant = await submitMyMerchantOnboarding(
        {
          ...form,
          contact_number: form.contact_number.trim() ? `+63 ${form.contact_number.trim()}` : "",
          available_days: [...form.available_days].sort((a, b) => dayOrder(a) - dayOrder(b)),
        },
        rsbsaFile,
      );
      setSuccessMerchant(merchant);
    } catch (e: any) {
      const message =
        e?.response?.data?.detail ||
        "Unable to submit your merchant application right now. Please try again.";
      setError(String(message));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyAndSubmit = async () => {
    setOtpError(null);
    setIsVerifyingOtp(true);
    try {
      await verifyOtp(fullPhoneNumber, otpValue);
    } catch (e: any) {
      setOtpError(e?.response?.data?.detail || "Incorrect code. Please try again.");
      setIsVerifyingOtp(false);
      return;
    }
    setIsVerifyingOtp(false);
    await submit();
  };

  if (successMerchant) {
    return (
      <div className={styles.page}>
        <section className={styles.card}>
          <h1 className={styles.title}>Application submitted</h1>
          <p className={styles.subtitle}>
            You can now access your merchant page and start setting up your shop.
          </p>
          <div className={styles.successBox}>
            <div>
              <div className={styles.successLabel}>Merchant</div>
              <div className={styles.successValue}>{successMerchant.merchant_name}</div>
            </div>
            <div className={styles.successActions}>
              <Link className={styles.primaryBtn} href={`/merchant/${successMerchant.id}`}>Go to merchant page</Link>
              <button className={styles.secondaryBtn} type="button" onClick={() => router.push("/profile")}>Back to profile</button>
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
            <p className={styles.subtitle}>A short onboarding to verify your details and RSBSA document.</p>
          </div>
          <div className={styles.progress}>
            <span className={styles.progressPill}>{progressLabel}</span>
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
          {step.id === "legal" && (
            <div className={styles.grid}>
              <div className={styles.field}>
                <label className={styles.label}>Merchant name</label>
                <input className={styles.input} value={form.merchant_name} onChange={setField("merchant_name")} placeholder="Carabao Fresh Farm" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Legal business name</label>
                <input className={styles.input} value={form.legal_business_name} onChange={setField("legal_business_name")} placeholder="Carabao Fresh Farm Trading" />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Business type</label>
                <select className={styles.select} value={form.business_type} onChange={setField("business_type")}>
                  <option value="Sole Proprietor">Sole Proprietor</option>
                  <option value="Partnership">Partnership</option>
                  <option value="Corporation">Corporation</option>
                  <option value="Cooperative">Cooperative</option>
                  <option value="Farmer">Farmer</option>
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>TIN (optional)</label>
                <input
                  className={styles.input}
                  value={form.tin ?? ""}
                  onChange={handleTIN}
                  placeholder="123-456-789-000"
                  inputMode="numeric"
                  maxLength={15}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Registration type</label>
                <select className={styles.select} value={form.registration_type ?? ""} onChange={setField("registration_type")}>
                  <option value="DTI">DTI</option>
                  <option value="SEC">SEC</option>
                  <option value="CDA">CDA</option>
                  <option value="LGU">LGU / Permit</option>
                  <option value="">None</option>
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Registration number (optional)</label>
                <input
                  className={styles.input}
                  value={form.registration_number ?? ""}
                  onChange={handleRegNum}
                  placeholder="DTI-00000-000000"
                  maxLength={30}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Contact email</label>
                <input className={styles.input} type="email" value={form.contact_email} onChange={setField("contact_email")} placeholder="you@farm.com" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Contact number</label>
                <div className={styles.phoneRow}>
                  <span className={styles.phonePrefix}>+63</span>
                  <input
                    className={styles.phoneInput}
                    value={form.contact_number}
                    onChange={handlePhone}
                    placeholder="912 345 6789"
                    inputMode="numeric"
                    maxLength={12}
                  />
                </div>
              </div>
            </div>
          )}

          {step.id === "ops" && (
            <div className={styles.grid}>
              <div className={`${styles.field} ${styles.fieldFull}`}>
                <label className={styles.label}>Address</label>
                <input className={styles.input} value={form.address_line} onChange={setField("address_line")} placeholder="Street, Barangay" />
              </div>

              <LocationSelects
                value={form.city}
                onChange={(city) => setForm((prev) => ({ ...prev, city }))}
                onRegionChange={(region) => setForm((prev) => ({ ...prev, region, province: region }))}
                selectClassName={styles.select}
                labelClassName={styles.label}
                wrapClassName={styles.field}
              />

              <div className={styles.field}>
                <label className={styles.label}>Postal code (optional)</label>
                <input className={styles.input} value={form.postal_code ?? ""} onChange={setField("postal_code")} placeholder="1634" />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Price range (min)</label>
                <input className={styles.input} inputMode="numeric" value={String(form.price_range_min)} onChange={setField("price_range_min")} placeholder="0" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Price range (max)</label>
                <input className={styles.input} inputMode="numeric" value={String(form.price_range_max)} onChange={setField("price_range_max")} placeholder="0" />
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
            </div>
          )}

          {step.id === "docs" && (
            <div className={styles.docs}>
              <div className={styles.docsIntro}>
                <p className={styles.docsText}>
                  Upload either a clear photo or a PDF scan of your Philippine RSBSA document.
                </p>
              </div>

              <div className={styles.grid}>
                <div className={styles.field}>
                  <label className={styles.label}>RSBSA number (optional)</label>
                  <input
                    className={styles.input}
                    value={form.rsbsa_number ?? ""}
                    onChange={handleRSBSA}
                    placeholder="RSBSA-XXXX-XXXX"
                    maxLength={24}
                  />
                </div>

                <div className={`${styles.field} ${styles.fieldFull}`}>
                  <label className={styles.label}>RSBSA document (photo or PDF)</label>
                  <div
                    className={`${styles.dropzone} ${dragOver ? styles.dropzoneDragOver : ""} ${rsbsaFile ? styles.dropzoneWithFile : ""}`}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) setRsbsaFile(file);
                    }}
                  >
                    {rsbsaFile ? (
                      <div className={styles.fileCard}>
                        <span className={styles.fileCardIcon}>
                          {rsbsaFile.type === "application/pdf" ? (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                              <line x1="9" y1="13" x2="15" y2="13" />
                              <line x1="9" y1="17" x2="15" y2="17" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                              <circle cx="8.5" cy="8.5" r="1.5" />
                              <polyline points="21 15 16 10 5 21" />
                            </svg>
                          )}
                        </span>
                        <div className={styles.fileCardInfo}>
                          <span className={styles.fileCardName}>{rsbsaFile.name}</span>
                          <span className={styles.fileCardMeta}>
                            {rsbsaFile.type === "application/pdf" ? "PDF" : rsbsaFile.type.split("/")[1]?.toUpperCase()} · {(rsbsaFile.size / 1024).toFixed(0)} KB
                          </span>
                        </div>
                        <button
                          type="button"
                          className={styles.fileCardRemove}
                          onClick={() => setRsbsaFile(null)}
                          aria-label="Remove file"
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <label className={styles.dropzoneLabel}>
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          style={{ display: "none" }}
                          onChange={(e) => setRsbsaFile(e.target.files?.[0] ?? null)}
                        />
                        <svg className={styles.dropzoneIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="16 16 12 12 8 16" />
                          <line x1="12" y1="12" x2="12" y2="21" />
                          <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
                        </svg>
                        <span className={styles.dropzoneTitle}>Drop your file here</span>
                        <span className={styles.dropzoneSubtitle}>or click to browse</span>
                        <span className={styles.dropzoneMeta}>PDF · PNG · JPG · WEBP · max 10 MB</span>
                      </label>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step.id === "verify" && (
            <div className={styles.verifyStep}>
              <div className={styles.verifyPhoneBox}>
                <div className={styles.verifyPhoneLeft}>
                  <span className={styles.verifyPhoneLabel}>Contact number</span>
                  <span className={styles.verifyPhoneNum}>+63 {form.contact_number}</span>
                </div>
                <button
                  type="button"
                  className={styles.editPhoneBtn}
                  onClick={() => { setStepIndex(0); setOtpSent(false); setOtpValue(""); setOtpError(null); }}
                >
                  Edit
                </button>
              </div>

              {!otpSent ? (
                <button
                  type="button"
                  className={styles.sendOtpBtn}
                  onClick={handleSendOtp}
                  disabled={isSendingOtp}
                >
                  {isSendingOtp ? "Sending…" : "Send verification code"}
                </button>
              ) : (
                <div className={styles.otpGroup}>
                  <p className={styles.otpHint}>
                    Enter the 6-digit code sent to your number.
                  </p>
                  <input
                    className={styles.otpInput}
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="––––––"
                    value={otpValue}
                    onChange={(e) => setOtpValue(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    autoComplete="one-time-code"
                  />
                  <button
                    type="button"
                    className={styles.resendBtn}
                    disabled={resendCooldown > 0 || isSendingOtp}
                    onClick={handleSendOtp}
                  >
                    {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : "Resend code"}
                  </button>
                </div>
              )}

              {otpError && <div className={styles.errorBox}>{otpError}</div>}
            </div>
          )}

          {step.id !== "verify" && error && <div className={styles.errorBox}>{error}</div>}
          {step.id === "verify" && error && <div className={styles.errorBox}>{error}</div>}
        </div>

        <footer className={styles.footer}>
          <button
            className={styles.secondaryBtn}
            type="button"
            onClick={goBack}
            disabled={stepIndex === 0 || isSubmitting || isVerifyingOtp}
          >
            Back
          </button>
          {stepIndex < STEPS.length - 1 ? (
            <button className={styles.primaryBtn} type="button" onClick={goNext} disabled={isSubmitting}>
              Continue
            </button>
          ) : (
            <button
              className={styles.primaryBtn}
              type="button"
              onClick={handleVerifyAndSubmit}
              disabled={!otpSent || otpValue.length < 6 || isVerifyingOtp || isSubmitting}
            >
              {isVerifyingOtp || isSubmitting ? "Submitting…" : "Verify & Submit"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
