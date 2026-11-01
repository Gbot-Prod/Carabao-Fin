"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ADMIN_PAGE_SIZE, fetchAdminMerchantsPage, type Merchant } from "@/util/api/admin";
import Pagination from "../../Pagination";
import styles from "./page.module.css";
import PageLoader from "@/components/PageLoader/PageLoader";

export default function AdminMerchantsPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading merchants…" />}>
      <AdminMerchantsContent />
    </Suspense>
  );
}

function AdminMerchantsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedPage, setLoadedPage] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAdminMerchantsPage(page)
      .then((res) => {
        setMerchants(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch(() => setError("Failed to load merchants."))
      .finally(() => setLoadedPage(page));
  }, [page]);

  const loading = loadedPage !== page;

  const goToPage = (next: number) => {
    router.push(`${pathname}?page=${next}`);
  };

  if (loading && merchants.length === 0) return <PageLoader label="Loading merchants…" />;
  if (error) return <div className={styles.stateError}>{error}</div>;

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Merchants <span className={styles.count}>{total}</span></h1>
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
                <td>{m.address ?? <span className={styles.empty}>—</span>}</td>
                <td>{m.contact_number}</td>
                <td>{m.operating_hours != null ? (typeof m.operating_hours === 'string' ? m.operating_hours : JSON.stringify(m.operating_hours)) : <span className={styles.empty}>—</span>}</td>
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
      <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} total={total} disabled={loading} onPageChange={goToPage} />
    </div>
  );
}
