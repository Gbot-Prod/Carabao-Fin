"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchMyProfile, updateMyProfile } from "@/util/api";
import { signUp } from "@/lib/auth-client";
import TermsModal from "@/components/TermsModal/TermsModal";
import LocationSelects from "@/components/LocationSelects/LocationSelects";
import styles from "./page.module.css";

type FormData = {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  streetAddress: string;
  region: string;
  province: string;
  city: string;
  barangay: string;
  zipCode: string;
};

const EMPTY: FormData = { firstName: "", lastName: "", phoneNumber: "", streetAddress: "", region: "", province: "", city: "", barangay: "", zipCode: "" };

export default function OnboardingPage() {
  const router = useRouter();
  const [pendingSignup, setPendingSignup] = useState<{ channel: "email" | "phone"; identifier: string } | null>(null);
  const [accountEmail, setAccountEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(EMPTY);

  useEffect(() => {
    const rawPendingSignup = sessionStorage.getItem("pending_signup");
    if (rawPendingSignup) {
      try {
        const parsed = JSON.parse(rawPendingSignup) as { channel?: string; identifier?: string };
        if ((parsed.channel === "email" || parsed.channel === "phone") && parsed.identifier) {
          setPendingSignup({ channel: parsed.channel, identifier: parsed.identifier });
          setAccountEmail(parsed.channel === "email" ? parsed.identifier : "");
          setFormData((prev) => ({ ...prev, phoneNumber: parsed.channel === "phone" ? parsed.identifier! : prev.phoneNumber }));
          return;
        }
      } catch {
        sessionStorage.removeItem("pending_signup");
      }
    }

    const prefill = async () => {
      try {
        const p = await fetchMyProfile();
        setFormData({
          firstName: p.first_name ?? "",
          lastName: p.last_name ?? "",
          phoneNumber: p.phone_number ?? "",
          streetAddress: p.address ?? "",
          region: p.region ?? "",
          province: p.province ?? "",
          city: p.city ?? "",
          barangay: p.barangay ?? "",
          zipCode: p.postal_code ?? "",
        });
      } catch {
        // No prefill on error — user starts with empty form.
      }
    };
    void prefill();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveError(null);

    try {
      if (pendingSignup) {
        if (!accountEmail.trim() || !password || password !== confirmPassword) {
          setSaveError("Enter a valid email and matching password to create your account.");
          setIsSaving(false);
          return;
        }
        if (!termsAccepted) {
          setSaveError("You must agree to the Terms of Service to create an account.");
          setIsSaving(false);
          return;
        }
        await signUp.email({
          email: accountEmail.trim(),
          password,
          name: `${formData.firstName.trim()} ${formData.lastName.trim()}`.trim(),
        });
        const syncResponse = await fetch("/api/auth", { method: "POST", credentials: "include" });
        if (!syncResponse.ok) {
          throw new Error("Could not finish account setup");
        }
      }

      await updateMyProfile({
        first_name: formData.firstName.trim() || null,
        last_name: formData.lastName.trim() || null,
        phone_number: formData.phoneNumber.trim() || null,
        address: formData.streetAddress.trim() || null,
        region: formData.region.trim() || null,
        province: formData.province.trim() || null,
        city: formData.city.trim() || null,
        barangay: formData.barangay.trim() || null,
        postal_code: formData.zipCode.trim() || null,
      });
      sessionStorage.removeItem("pending_signup");
      document.cookie = "pending_signup_verification=; Path=/; Max-Age=0; SameSite=Lax";
      router.push("/order");
    } catch {
      setSaveError("Could not save your profile. Please check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      {showTerms && (
        <TermsModal
          onClose={() => setShowTerms(false)}
          onAgree={() => {
            setTermsAccepted(true);
            setShowTerms(false);
          }}
        />
      )}
      <div className={styles.card}>

        <h1 className={styles.title}>Complete your profile</h1>
        <p className={styles.subtitle}>
          {pendingSignup ? "Set your account password, then add your profile details." : "All fields are optional — fill in what you have now and update anytime."}
        </p>

        <form onSubmit={handleSubmit} className={styles.form}>
          {pendingSignup && (
            <>
              <div>
                <label className={styles.label}>Account email</label>
                <input
                  type="email"
                  required
                  value={accountEmail}
                  onChange={(e) => setAccountEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={styles.input}
                  readOnly={pendingSignup.channel === "email"}
                />
              </div>
              <div>
                <label className={styles.label}>Password</label>
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={styles.input} />
              </div>
              <div>
                <label className={styles.label}>Confirm password</label>
                <input type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={styles.input} />
              </div>
              <label className={styles.termsRow}>
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                />
                <span>
                  I agree to the{" "}
                  <button type="button" onClick={() => setShowTerms(true)} className={styles.termsLink}>
                    Terms of Service
                  </button>
                </span>
              </label>
            </>
          )}

          {/* Name row */}
          <div className={styles.nameRow}>
            <div>
              <label className={styles.label}>First name</label>
              <input name="firstName" value={formData.firstName} onChange={handleChange} placeholder="Juan" className={styles.input} />
            </div>
            <div>
              <label className={styles.label}>Last name</label>
              <input name="lastName" value={formData.lastName} onChange={handleChange} placeholder="dela Cruz" className={styles.input} />
            </div>
          </div>

          <div>
            <label className={styles.label}>Phone number</label>
            <input type="tel" name="phoneNumber" value={formData.phoneNumber} onChange={handleChange} placeholder="+63 912 345 6789" className={styles.input} />
          </div>

          <LocationSelects
              value={{
                region: formData.region,
                province: formData.province,
                city: formData.city,
                barangay: formData.barangay,
              }}
              onChange={(location) => 
                setFormData((previous) => ({ 
                  ...previous,
                  ...location
                }))
              }
              selectClassName={styles.input}
              labelClassName={styles.label}
          />
          
          <div>
            <label className={styles.label}>Street address</label>
            <input type="text" name="streetAddress" value={formData.streetAddress} onChange={handleChange} placeholder="123 Rizal Ave" className={styles.input} />
          </div>

          <div>
            <label className={styles.label}>ZIP code</label>
            <input type="text" name="zipCode" value={formData.zipCode} onChange={handleChange} placeholder="1634" className={styles.input} />
          </div>

          {saveError && (
            <p className={styles.error}>
              {saveError}
            </p>
          )}

          <div className={styles.actions}>
            <button
              type="submit"
              disabled={isSaving}
              className={styles.submitButton}
            >
              {isSaving ? "Saving…" : "Save and continue"}
            </button>
          </div>
        </form>

        <div className={styles.skip}>
          <Link href="/order">
            Skip for now → go to app
          </Link>
        </div>
      </div>
    </div>
  );
}
