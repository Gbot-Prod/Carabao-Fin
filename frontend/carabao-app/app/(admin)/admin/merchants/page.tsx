"use client";

import { useEffect, useState } from "react";
import { fetchAdminMerchants, type Merchant } from "@/util/api/admin";
import styles from "./page.module.css";

export default function AdminMerchantsPage() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAdminMerchants()
      .then(setMerchants)
      .catch(() => setError("Failed to load merchants."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className={styles.state}>Loading…</div>;
  if (error) return <div className={styles.stateError}>{error}</div>;

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Merchants <span className={styles.count}>{merchants.length}</span></h1>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Location</th>
              <th>Contact</th>
              <th>Hours</th>
              <th>Delivery</th>
              <th>Rating</th>
              <th>Products</th>
            </tr>
          </thead>
          <tbody>
            {merchants.map((m) => (
              <tr key={m.id}>
                <td className={styles.mono}>{m.id}</td>
                <td className={styles.bold}>{m.merchant_name}</td>
                <td>{m.location ?? <span className={styles.empty}>—</span>}</td>
                <td>{m.contact_number}</td>
                <td>{m.operating_hours ?? <span className={styles.empty}>—</span>}</td>
                <td>
                  {m.delivery_price != null
                    ? `₱${m.delivery_price}${m.delivery_time != null ? ` · ${m.delivery_time}d` : ""}`
                    : <span className={styles.empty}>—</span>}
                </td>
                <td>{m.rating ?? <span className={styles.empty}>—</span>}</td>
                <td className={styles.mono}>{m.produces.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
