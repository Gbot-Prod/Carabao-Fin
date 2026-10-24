"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchMyProfile, updateMyProfile } from "@/util/api";
import { signUp } from "@/lib/auth-client";
import TermsModal from "@/components/TermsModal/TermsModal";
import LocationSelects from "@/components/LocationSelects/LocationSelects";

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

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 12px",
    border: "1px solid #d0e4d5",
    borderRadius: 8,
    fontSize: 14,
    color: "#173d25",
    background: "#f9fcf9",
    boxSizing: "border-box",
    fontFamily: "inherit",
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    color: "#5c6a5e",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    display: "block",
    marginBottom: 5,
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg, #f7fcf8 0%, #ecf6ef 100%)", padding: 16 }}>
      {showTerms && (
        <TermsModal
          onClose={() => setShowTerms(false)}
          onAgree={() => {
            setTermsAccepted(true);
            setShowTerms(false);
          }}
        />
      )}
      <div style={{ background: "white", borderRadius: 16, padding: "32px 28px", width: "100%", maxWidth: 500, boxShadow: "0 4px 20px rgba(0,0,0,0.10)" }}>

        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px", color: "#173d25" }}>Complete your profile</h1>
        <p style={{ fontSize: 14, color: "#647067", margin: "0 0 28px" }}>
          {pendingSignup ? "Set your account password, then add your profile details." : "All fields are optional — fill in what you have now and update anytime."}
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {pendingSignup && (
            <>
              <div>
                <label style={labelStyle}>Account email</label>
                <input
                  type="email"
                  required
                  value={accountEmail}
                  onChange={(e) => setAccountEmail(e.target.value)}
                  placeholder="you@example.com"
                  style={inputStyle}
                  readOnly={pendingSignup.channel === "email"}
                />
              </div>
              <div>
                <label style={labelStyle}>Password</label>
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Confirm password</label>
                <input type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} style={inputStyle} />
              </div>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "#647067", lineHeight: 1.4 }}>
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  style={{ marginTop: 2, accentColor: "#31925d" }}
                />
                <span>
                  I agree to the{" "}
                  <button type="button" onClick={() => setShowTerms(true)} style={{ border: 0, background: "none", padding: 0, color: "#2f8f57", font: "inherit", fontWeight: 600, textDecoration: "underline", cursor: "pointer" }}>
                    Terms of Service
                  </button>
                </span>
              </label>
            </>
          )}

          {/* Name row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <div>
              <label style={labelStyle}>First name</label>
              <input name="firstName" value={formData.firstName} onChange={handleChange} placeholder="Juan" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Last name</label>
              <input name="lastName" value={formData.lastName} onChange={handleChange} placeholder="dela Cruz" style={inputStyle} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Phone number</label>
            <input type="tel" name="phoneNumber" value={formData.phoneNumber} onChange={handleChange} placeholder="+63 912 345 6789" style={inputStyle} />
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
              selectStyle={inputStyle}
              labelStyle={labelStyle}
          />
          
          <div>
            <label style={labelStyle}>Street address</label>
            <input type="text" name="streetAddress" value={formData.streetAddress} onChange={handleChange} placeholder="123 Rizal Ave" style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>ZIP code</label>
            <input type="text" name="zipCode" value={formData.zipCode} onChange={handleChange} placeholder="1634" style={inputStyle} />
          </div>

          {saveError && (
            <p style={{ margin: 0, padding: "10px 12px", borderRadius: 8, background: "#fdecea", color: "#b91c1c", fontSize: 13 }}>
              {saveError}
            </p>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button
              type="submit"
              disabled={isSaving}
              style={{ flex: 1, padding: "11px 0", background: isSaving ? "#7cbf9e" : "#31925d", color: "white", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: isSaving ? "not-allowed" : "pointer", fontFamily: "inherit" }}
            >
              {isSaving ? "Saving…" : "Save and continue"}
            </button>
          </div>
        </form>

        <div style={{ marginTop: 20, textAlign: "center" }}>
          <Link href="/order" style={{ fontSize: 13, color: "#5c6a5e", textDecoration: "underline" }}>
            Skip for now → go to app
          </Link>
        </div>
      </div>
    </div>
  );
}
