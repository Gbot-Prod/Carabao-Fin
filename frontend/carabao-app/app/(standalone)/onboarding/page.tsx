"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function OnboardingPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    phoneNumber: "",
    streetAddress: "",
    city: "",
    province: "",
    zipCode: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8f8f8" }}>
      <div style={{ background: "white", borderRadius: 16, padding: "2rem", width: "100%", maxWidth: 480, boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
        <p style={{ fontSize: 13, color: "#888", marginBottom: 4 }}>Step 1 of 1</p>
        <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 4 }}>Complete your profile</h1>
        <p style={{ fontSize: 14, color: "#666", marginBottom: 24 }}>
          We need a few details to get your orders going.
        </p>

        <form onSubmit={() => {}} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 4 }}>Phone number</label>
            <input
              type="tel" name="phoneNumber" required
              placeholder="+63 912 345 6789"
              value={formData.phoneNumber} onChange={handleChange}
              style={{ width: "100%", padding: "8px 12px", border: "1px solid #ddd", borderRadius: 8, fontSize: 14 }}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 4 }}>Street address</label>
            <input
              type="text" name="streetAddress" required
              placeholder="123 Rizal Ave"
              value={formData.streetAddress} onChange={handleChange}
              style={{ width: "100%", padding: "8px 12px", border: "1px solid #ddd", borderRadius: 8, fontSize: 14 }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 4 }}>City</label>
              <input type="text" name="city" required placeholder="Taguig"
                value={formData.city} onChange={handleChange}
                style={{ width: "100%", padding: "8px 12px", border: "1px solid #ddd", borderRadius: 8, fontSize: 14 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 4 }}>ZIP code</label>
              <input type="text" name="zipCode" required placeholder="1634"
                value={formData.zipCode} onChange={handleChange}
                style={{ width: "100%", padding: "8px 12px", border: "1px solid #ddd", borderRadius: 8, fontSize: 14 }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 4 }}>Province</label>
            <input type="text" name="province" required placeholder="Metro Manila"
              value={formData.province} onChange={handleChange}
              style={{ width: "100%", padding: "8px 12px", border: "1px solid #ddd", borderRadius: 8, fontSize: 14 }}
            />
          </div>

          <button type="submit" disabled={isLoading}
            style={{ marginTop: 8, padding: "10px", background: "#079135", color: "white", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: "pointer" }}
          >
            {isLoading ? "Saving..." : "Save and continue"}
          </button>
        </form>
      </div>
    </div>
  );
}