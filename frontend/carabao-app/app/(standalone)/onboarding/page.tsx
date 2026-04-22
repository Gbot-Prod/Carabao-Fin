"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchMyProfile, updateMyProfile } from "@/util/api";

type FormData = {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  streetAddress: string;
  city: string;
  province: string;
  zipCode: string;
};

const EMPTY: FormData = { firstName: "", lastName: "", phoneNumber: "", streetAddress: "", city: "", province: "", zipCode: "" };

export default function OnboardingPage() {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(EMPTY);

  useEffect(() => {
    const prefill = async () => {
      try {
        const p = await fetchMyProfile();
        setFormData({
          firstName: p.first_name ?? "",
          lastName: p.last_name ?? "",
          phoneNumber: p.phone_number ?? "",
          streetAddress: p.address ?? "",
          city: p.city ?? "",
          province: p.country ?? "",
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
      await updateMyProfile({
        first_name: formData.firstName.trim() || null,
        last_name: formData.lastName.trim() || null,
        phone_number: formData.phoneNumber.trim() || null,
        address: formData.streetAddress.trim() || null,
        city: formData.city.trim() || null,
        country: formData.province.trim() || null,
        postal_code: formData.zipCode.trim() || null,
      });
      router.push("/profile");
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
      <div style={{ background: "white", borderRadius: 16, padding: "32px 28px", width: "100%", maxWidth: 500, boxShadow: "0 4px 20px rgba(0,0,0,0.10)" }}>

        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px", color: "#173d25" }}>Complete your profile</h1>
        <p style={{ fontSize: 14, color: "#647067", margin: "0 0 28px" }}>
          All fields are optional — fill in what you have now and update anytime.
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Name row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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

          <div>
            <label style={labelStyle}>Street address</label>
            <input type="text" name="streetAddress" value={formData.streetAddress} onChange={handleChange} placeholder="123 Rizal Ave" style={inputStyle} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>City</label>
              <input type="text" name="city" value={formData.city} onChange={handleChange} placeholder="Taguig" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>ZIP code</label>
              <input type="text" name="zipCode" value={formData.zipCode} onChange={handleChange} placeholder="1634" style={inputStyle} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Province / Country</label>
            <input type="text" name="province" value={formData.province} onChange={handleChange} placeholder="Metro Manila" style={inputStyle} />
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
          <Link href="/profile" style={{ fontSize: 13, color: "#5c6a5e", textDecoration: "underline" }}>
            Skip for now → go to profile
          </Link>
        </div>
      </div>
    </div>
  );
}
