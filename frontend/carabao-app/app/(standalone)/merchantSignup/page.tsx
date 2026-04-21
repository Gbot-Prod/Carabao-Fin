"use client";

import { FormEvent, useState } from "react";
import styles from "./page.module.css";
import { createMyMerchant } from "@/util/api";

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
  const [error, setError] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSuccess("");
    setError("");
    setIsSubmitting(true);

    try {
      await createMyMerchant({
        merchant_name: form.merchant_name,
        location: form.location,
        contact_number: form.contact_number,
        operating_hours: form.operating_hours,
        delivery_price: form.delivery_price ? Number(form.delivery_price) : null,
        delivery_time: form.delivery_time ? Number(form.delivery_time) : null,
        rating: form.rating ? Number(form.rating) : null,
      });

      setSuccess("Merchant profile created successfully.");
      setForm(initialForm);
    } catch {
      setError("Unable to create merchant profile. Please ensure you are logged in.");
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
        {error && <p className={styles.error}>{error}</p>}

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