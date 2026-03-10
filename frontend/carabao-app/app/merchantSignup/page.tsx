"use client";

import { FormEvent, useState } from "react";
import styles from "./page.module.css";

type MerchantForm = {
  merchant_name: string;
  location: string;
  contact_number: string;
  operating_hours: string;
  delivery_price: string;
  delivery_time: string;
  rating: string;
};

const initialForm: MerchantForm = {
  merchant_name: "",
  location: "",
  contact_number: "",
  operating_hours: "",
  delivery_price: "",
  delivery_time: "",
  rating: "",
};

export default function MerchantLanding() {
  const [form, setForm] = useState<MerchantForm>(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSuccess("");
    setIsSubmitting(true);

    try {
      await new Promise((resolve) => setTimeout(resolve, 350));

      setSuccess("Form is ready. API integration will be added later.");
      setForm(initialForm);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className={styles.container}>
      <section className={styles.card}>
        <h1 className={styles.title}>Merchant Signup</h1>
        <p className={styles.subtitle}>Create your merchant profile to start selling.</p>

        {success && <p className={styles.success}>{success}</p>}

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>Merchant Name</span>
            <input
              name="merchant_name"
              type="text"
              value={form.merchant_name}
              onChange={handleChange}
              placeholder="Carabao Fresh Farm"
              required
            />
          </label>

          <label className={styles.field}>
            <span>Location</span>
            <input
              name="location"
              type="text"
              value={form.location}
              onChange={handleChange}
              placeholder="Tagaytay, Cavite"
              required
            />
          </label>

          <label className={styles.field}>
            <span>Contact Number</span>
            <input
              name="contact_number"
              type="text"
              value={form.contact_number}
              onChange={handleChange}
              placeholder="+63 9XX XXX XXXX"
              required
            />
          </label>

          <label className={styles.field}>
            <span>Operating Hours</span>
            <input
              name="operating_hours"
              type="text"
              value={form.operating_hours}
              onChange={handleChange}
              placeholder="Mon - Sat, 8:00 AM - 6:00 PM"
              required
            />
          </label>

          <button className={styles.button} type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Merchant"}
          </button>
        </form>
      </section>
    </main>
  );
}