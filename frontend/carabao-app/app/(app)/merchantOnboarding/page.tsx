"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import {
  fetchMyProfile,
  submitMyMerchantOnboarding,
  type Merchant,
  type MerchantOnboardingPayload,
} from "@/util/api";

type StepId = "legal" | "ops" | "docs";

const STEPS: { id: StepId; title: string; subtitle: string }[] = [
  { id: "legal", title: "Legal Details", subtitle: "Tell us who you are as a business." },
  { id: "ops", title: "Operations", subtitle: "Where you operate, your pricing, and availability." },
  { id: "docs", title: "RSBSA Upload", subtitle: "Upload a photo or PDF of your Philippine RSBSA." },
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function normalizePhone(v: string) {
  return v.replace(/\s+/g, " ").trim();
}

export default function MerchantOnboardingPage() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex] ?? STEPS[0]!;

  const [rsbsaFile, setRsbsaFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMerchant, setSuccessMerchant] = useState<Merchant | null>(null);

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
          contact_number: prev.contact_number || (p.phone_number ?? ""),
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

  const progressLabel = useMemo(() => `${stepIndex + 1} / ${STEPS.length}`, [stepIndex]);

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
      if (!normalizePhone(form.contact_number)) return "Contact number is required.";
      return null;
    }

    if (index === 1) {
      if (!form.address_line.trim()) return "Address is required.";
      if (!form.city.trim()) return "City / Municipality is required.";
      if (!form.province.trim()) return "Province is required.";
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
    setStepIndex((s) => Math.max(s - 1, 0));
  };

  const submit = async () => {
    setError(null);
    const validationError = validateStep(2);
    if (validationError) return setError(validationError);
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
          contact_number: normalizePhone(form.contact_number),
          available_days: [...form.available_days].sort(
            (a, b) => dayOrder(a) - dayOrder(b),
          ),
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
                <input className={styles.input} value={form.tin ?? ""} onChange={setField("tin")} placeholder="123-456-789-000" />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Registration type (optional)</label>
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
                <input className={styles.input} value={form.registration_number ?? ""} onChange={setField("registration_number")} placeholder="DTI/SEC/CDA number" />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Contact email</label>
                <input className={styles.input} type="email" value={form.contact_email} onChange={setField("contact_email")} placeholder="you@farm.com" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Contact number</label>
                <input className={styles.input} value={form.contact_number} onChange={setField("contact_number")} placeholder="+63 9XX XXX XXXX" />
              </div>
            </div>
          )}

          {step.id === "ops" && (
            <div className={styles.grid}>
              <div className={`${styles.field} ${styles.fieldFull}`}>
                <label className={styles.label}>Address</label>
                <input className={styles.input} value={form.address_line} onChange={setField("address_line")} placeholder="Street, Barangay" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>City / Municipality</label>
                <input className={styles.input} value={form.city} onChange={setField("city")} placeholder="Taguig" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Province</label>
                <input className={styles.input} value={form.province} onChange={setField("province")} placeholder="Metro Manila" />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Region (optional)</label>
                <input className={styles.input} value={form.region ?? ""} onChange={setField("region")} placeholder="NCR / Region IV-A" />
              </div>
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
                  <input className={styles.input} value={form.rsbsa_number ?? ""} onChange={setField("rsbsa_number")} placeholder="RSBSA-XXXX-XXXX" />
                </div>

                <div className={`${styles.field} ${styles.fieldFull}`}>
                  <label className={styles.label}>RSBSA document (photo or PDF)</label>
                  <input
                    className={styles.file}
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => setRsbsaFile(e.target.files?.[0] ?? null)}
                  />
                  {rsbsaFile && (
                    <div className={styles.fileMeta}>
                      <span className={styles.fileName}>{rsbsaFile.name}</span>
                      <span className={styles.fileSize}>{Math.round(rsbsaFile.size / 1024)} KB</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {error && <div className={styles.errorBox}>{error}</div>}
        </div>

        <footer className={styles.footer}>
          <button className={styles.secondaryBtn} type="button" onClick={goBack} disabled={stepIndex === 0 || isSubmitting}>
            Back
          </button>
          {stepIndex < STEPS.length - 1 ? (
            <button className={styles.primaryBtn} type="button" onClick={goNext} disabled={isSubmitting}>
              Continue
            </button>
          ) : (
            <button className={styles.primaryBtn} type="button" onClick={submit} disabled={isSubmitting}>
              {isSubmitting ? "Submitting..." : "Submit application"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
