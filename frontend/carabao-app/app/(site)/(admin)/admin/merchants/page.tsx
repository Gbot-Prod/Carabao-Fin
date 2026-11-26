"use client";

import { Fragment, Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ADMIN_PAGE_SIZE,
  fetchAdminMerchantsPage,
  type AdminMerchant,
  type AdminMerchantSort,
} from "@/util/api/admin";
import { SELLER_TYPE_LABELS } from "@/util/api/merchants";
import { appUrl } from "@/lib/urls";
import SuspendControl from "../../SuspendControl";
import styles from "./page.module.css";
import PageHeader from "../../PageHeader";
import PageLoader from "@/components/PageLoader/PageLoader";
import ExpandToggle, { formatDate, formatDateTime } from "../../ExpandToggle";
import details from "../../details.module.css";
import SortHeader, { readSort, writeSort, type SortState } from "../../SortHeader";
import TablePanel, { TablePage, TableSearch, TableSort, type SortOption } from "../../TablePanel";

const SORT_KEYS = ["id", "name", "location", "rating", "products", "delivery", "approved"] as const;
const SORT_OPTIONS: SortOption<AdminMerchantSort>[] = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "location", label: "Location" },
  { key: "delivery", label: "Delivery" },
  { key: "rating", label: "Rating", firstOrder: "desc" },
  { key: "products", label: "Products", firstOrder: "desc" },
  { key: "approved", label: "Approval date", firstOrder: "desc" },
];
const COLUMNS = 11;

/** Products shown in the shop preview before the "see all" link. */
const PREVIEW_PRODUCTS = 8;

const formatHours = (hours: AdminMerchant["operating_hours"]): string | null => {
  if (hours == null) return null;
  if (typeof hours === "string") return hours || null;
  const entries = Object.entries(hours);
  if (entries.length === 0) return null;
  return entries.map(([k, v]) => `${k}: ${v}`).join(" · ");
};

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
  const q = searchParams.get("q")?.trim() ?? "";
  const { sort, order } = readSort<AdminMerchantSort>(searchParams, SORT_KEYS);
  const current: SortState<AdminMerchantSort> = { sort, order };
  const key = `${q}|${sort ?? ""}|${order}|${page}`;

  const [merchants, setMerchants] = useState<AdminMerchant[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    fetchAdminMerchantsPage(page, { q: q || undefined, ...(sort ? { sort, order } : {}) })
      .then((res) => {
        setMerchants(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch(() => setError("Failed to load merchants."))
      .finally(() => setLoadedKey(`${q}|${sort ?? ""}|${order}|${page}`));
  }, [q, sort, order, page]);

  const loading = loadedKey !== key;

  const go = (next: { q?: string; sort?: SortState<AdminMerchantSort>; page?: number }) => {
    const params = new URLSearchParams();
    const nextQ = next.q ?? q;
    if (nextQ) params.set("q", nextQ);
    writeSort(params, next.sort ?? current);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };
  const onSort = (next: SortState<AdminMerchantSort>) => go({ sort: next, page: 1 });

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const firstLoad = loading && merchants.length === 0 && !error;

  return (
    <TablePage>
      <PageHeader eyebrow="People" title="Merchants" count={total} description="Approved stores selling on Carabao." />
      <TablePanel
        sort={<TableSort options={SORT_OPTIONS} current={current} onSort={onSort} />}
        search={<TableSearch applied={q} onSearch={(v) => go({ q: v, page: 1 })} placeholder="Store, city, owner email or #id" label="Search merchants" />}
        message={
          firstLoad
            ? "Loading merchants…"
            : (error ?? (merchants.length === 0 ? (q ? "No merchants match this search." : "No merchants yet.") : null))
        }
        messageTone={error ? "error" : undefined}
        loading={loading}
        pagination={{ page, pageSize: ADMIN_PAGE_SIZE, total, onPageChange: (p) => go({ page: p }) }}
      >
        <table>
          <thead>
            <tr>
              <th className={details.toggleCell} aria-label="Details" />
              <SortHeader label="ID" sortKey="id" current={current} onSort={onSort} />
              <SortHeader label="Name" sortKey="name" current={current} onSort={onSort} />
              <SortHeader label="Location" sortKey="location" current={current} onSort={onSort} />
              <th>Contact</th>
              <th>Hours</th>
              <SortHeader label="Delivery" sortKey="delivery" current={current} onSort={onSort} />
              <SortHeader label="Rating" sortKey="rating" current={current} onSort={onSort} firstOrder="desc" />
              <SortHeader label="Products" sortKey="products" current={current} onSort={onSort} firstOrder="desc" />
              <SortHeader label="Approval date" sortKey="approved" current={current} onSort={onSort} firstOrder="desc" />
              <th>Account</th>
            </tr>
          </thead>
          <tbody>
            {merchants.map((m) => {
              const open = expanded.has(m.id);
              const detailId = `merchant-details-${m.id}`;
              return (
                <Fragment key={m.id}>
                  <tr className={open ? details.openRow : undefined}>
                    <td className={details.toggleCell}>
                      <ExpandToggle expanded={open} controls={detailId} label={m.merchant_name} onToggle={() => toggle(m.id)} />
                    </td>
                    <td className={styles.mono}>{m.id}</td>
                    <td className={styles.bold}>{m.merchant_name}</td>
                    <td>
                      {m.address ?? <span className={styles.empty}>—</span>}
                      {m.city && <div className={styles.sub}>{m.city}</div>}
                    </td>
                    <td>{m.contact_number}</td>
                    <td>{formatHours(m.operating_hours) ?? <span className={styles.empty}>—</span>}</td>
                    <td>
                      {m.delivery_price != null
                        ? `₱${m.delivery_price}${m.delivery_time != null ? ` · ${m.delivery_time}d` : ""}`
                        : <span className={styles.empty}>—</span>}
                    </td>
                    <td>{m.rating ?? <span className={styles.empty}>—</span>}</td>
                    <td className={styles.mono}>{m.produces.length}</td>
                    <td className={styles.mono}>{formatDate(m.verified_at) ?? <span className={styles.empty}>—</span>}</td>
                    <td>
                      <SuspendControl
                        userId={m.user_id}
                        suspended={m.owner_is_suspended}
                        reason={m.owner_suspension_reason}
                        isMerchant
                        onChange={(suspended, reason) =>
                          setMerchants((prev) =>
                            prev.map((x) =>
                              x.id === m.id ? { ...x, owner_is_suspended: suspended, owner_suspension_reason: reason } : x,
                            ),
                          )
                        }
                      />
                    </td>
                  </tr>
                  {open && (
                    <tr id={detailId} className={details.detailRow}>
                      <td colSpan={COLUMNS}>
                        <MerchantDetails merchant={m} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </TablePanel>
    </TablePage>
  );
}

function MerchantDetails({ merchant: m }: { merchant: AdminMerchant }) {
  const dash = <span className={details.muted}>—</span>;
  const place = [m.barangay, m.city, m.province, m.region].filter(Boolean).join(", ");
  const hours = formatHours(m.operating_hours);
  const hasPin = m.lat != null && m.lng != null;
  const hiddenCount = m.produces.filter((p) => p.hidden_at).length;
  const outOfStock = m.produces.filter((p) => !p.hidden_at && p.stock_quantity === 0).length;

  return (
    <div className={details.panel}>
      <div className={details.section}>
        <h3 className={details.sectionTitle}>Owner &amp; business</h3>
        <dl className={details.grid}>
          <div>
            <dt>Owner</dt>
            <dd>{m.owner_name ?? dash} <span className={details.muted}>(user #{m.user_id})</span></dd>
          </div>
          <div>
            <dt>Legal name</dt>
            <dd>{m.legal_business_name ?? dash}</dd>
          </div>
          <div>
            <dt>Seller type</dt>
            <dd>{m.seller_type ? SELLER_TYPE_LABELS[m.seller_type] : dash}</dd>
          </div>
          <div>
            <dt>Registration</dt>
            <dd>
              {m.registration_type || m.registration_number
                ? [m.registration_type, m.registration_number].filter(Boolean).join(" · ")
                : dash}
            </dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{m.contact_email ?? dash}</dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{m.contact_number ?? dash}</dd>
          </div>
          <div>
            <dt>Joined</dt>
            <dd>{formatDate(m.created_at) ?? dash}</dd>
          </div>
          <div>
            <dt>Verified</dt>
            <dd>{formatDateTime(m.verified_at) ?? dash}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              {m.deleted_at ? (
                <span className={details.badge}>Deleted {formatDate(m.deleted_at)}</span>
              ) : m.owner_is_suspended ? (
                <span className={details.badge}>Suspended</span>
              ) : (
                <span className={`${details.badge} ${details.badgeOk}`}>Active</span>
              )}
            </dd>
          </div>
          {m.owner_is_suspended && m.owner_suspension_reason && (
            <div className={details.wide}>
              <dt>Suspension reason</dt>
              <dd>{m.owner_suspension_reason}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className={details.section}>
        <h3 className={details.sectionTitle}>Location &amp; operations</h3>
        <dl className={details.grid}>
          <div className={details.wide}>
            <dt>Address</dt>
            <dd>
              {m.address ?? dash}
              {place && <div className={details.muted}>{place}{m.postal_code ? ` ${m.postal_code}` : ""}</div>}
            </dd>
          </div>
          <div>
            <dt>Map pin</dt>
            <dd>
              {hasPin ? (
                <a
                  href={`https://www.openstreetmap.org/?mlat=${m.lat}&mlon=${m.lng}#map=16/${m.lat}/${m.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={details.link}
                >
                  {m.lat!.toFixed(5)}, {m.lng!.toFixed(5)}
                </a>
              ) : (
                <span className={details.muted}>Not set</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Open days</dt>
            <dd>{m.available_days?.length ? m.available_days.join(", ") : dash}</dd>
          </div>
          <div>
            <dt>Hours</dt>
            <dd>{hours ?? dash}</dd>
          </div>
          <div>
            <dt>Delivery</dt>
            <dd>
              {m.delivery_price != null ? `₱${m.delivery_price} per order` : dash}
              {m.delivery_time != null && <div className={details.muted}>{m.delivery_time} day(s)</div>}
            </dd>
          </div>
          <div>
            <dt>Rating</dt>
            <dd>
              {m.rating != null ? `${m.rating.toFixed(1)} ★` : dash}{" "}
              <span className={details.muted}>({m.rating_count ?? 0} review{m.rating_count === 1 ? "" : "s"})</span>
            </dd>
          </div>
          <div>
            <dt>Listings</dt>
            <dd>
              {m.produces.length} total
              {(hiddenCount > 0 || outOfStock > 0) && (
                <div className={details.muted}>
                  {[hiddenCount && `${hiddenCount} hidden`, outOfStock && `${outOfStock} out of stock`].filter(Boolean).join(" · ")}
                </div>
              )}
            </dd>
          </div>
          <div>
            <dt>Low-stock alert</dt>
            <dd>{m.low_stock_threshold != null ? `At ${m.low_stock_threshold} units` : dash}</dd>
          </div>
        </dl>
      </div>

      <ShopPreview merchant={m} />
    </div>
  );
}

function ShopPreview({ merchant: m }: { merchant: AdminMerchant }) {
  const shop = m.shop_page;
  const title = shop?.title || m.merchant_name;
  const products = m.produces.slice(0, PREVIEW_PRODUCTS);
  const isPublic = !m.owner_is_suspended && !m.deleted_at;

  return (
    <section className={details.shop} aria-label={`Shop preview for ${m.merchant_name}`}>
      <div className={details.shopBar}>
        <span>Shop preview{shop ? "" : " · no shop page set up"}</span>
        {isPublic ? (
          <a href={appUrl(`/farms/${m.id}`)} target="_blank" rel="noreferrer" className={details.link}>
            Open public page ↗
          </a>
        ) : (
          <span className={details.muted}>Not visible to buyers</span>
        )}
      </div>

      {shop?.banner_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shop.banner_image_url} alt="" className={details.banner} />
      ) : (
        <div className={details.banner} />
      )}

      <div className={details.shopHead}>
        {shop?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shop.logo_url} alt="" className={details.logo} />
        ) : (
          <div className={`${details.logo} ${details.logoEmpty}`} aria-hidden="true">
            {title.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h4 className={details.shopTitle}>{title}</h4>
          <div className={details.shopMeta}>
            {[m.city, m.province].filter(Boolean).join(", ") || "No location"}
            {shop?.slug ? ` · /${shop.slug}` : ""}
          </div>
        </div>
      </div>

      <div className={details.shopDescription}>
        {shop?.description?.trim() ? (
          <p className={details.text}>{shop.description}</p>
        ) : (
          <p className={`${details.text} ${details.muted}`}>No shop description.</p>
        )}
      </div>

      {products.length === 0 ? (
        <div className={details.shopFoot}>
          <span className={details.muted}>This merchant has no listings yet.</span>
        </div>
      ) : (
        <>
          <div className={details.products}>
            {products.map((p) => (
              <div key={p.id} className={`${details.product} ${p.hidden_at ? details.productHidden : ""}`}>
                {p.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image_url} alt="" className={details.productImg} loading="lazy" />
                ) : (
                  <div className={`${details.productImg} ${details.photoEmpty}`}>No photo</div>
                )}
                {(p.hidden_at || p.stock_quantity === 0) && (
                  <span className={`${details.badge} ${details.productFlag}`}>
                    {p.hidden_at ? "Hidden" : "Out of stock"}
                  </span>
                )}
                <div className={details.productBody}>
                  <div className={details.productName} title={p.name ?? undefined}>{p.name ?? "Untitled"}</div>
                  <div className={details.productPrice}>₱{p.price} / {p.unit}</div>
                  <div className={details.productStock}>{p.stock_quantity} in stock</div>
                </div>
              </div>
            ))}
          </div>
          <div className={details.shopFoot}>
            <Link href={`/admin/listings?merchant=${m.id}`} className={details.link}>
              {m.produces.length > PREVIEW_PRODUCTS
                ? `See all ${m.produces.length} listings →`
                : "Manage these listings →"}
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
