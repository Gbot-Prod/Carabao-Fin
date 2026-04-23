"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export const SHOP_FILTERS = ["Fruits", "Veggies", "Popular", "Nearby", "Fast Delivery"];
const PRICE_OPTIONS = ["₱", "₱₱", "₱₱₱"];

function FilterChipsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeFilters = new Set(
    (searchParams.get("filters") ?? "").split(",").filter(Boolean)
  );
  const activePrice = searchParams.get("price") ?? "";

  const buildUrl = (filters: Set<string>, price: string) => {
    const params = new URLSearchParams();
    if (filters.size > 0) params.set("filters", Array.from(filters).join(","));
    if (price) params.set("price", price);
    const qs = params.toString();
    return qs ? `/order?${qs}` : "/order";
  };

  const toggleFilter = (filter: string) => {
    const next = new Set(activeFilters);
    next.has(filter) ? next.delete(filter) : next.add(filter);
    router.push(buildUrl(next, activePrice));
  };

  const selectPrice = (price: string) => {
    router.push(buildUrl(activeFilters, price === activePrice ? "" : price));
  };

  return (
    <div className="sidebar__filters">
      <span className="sidebar__filters-label">Filter by</span>
      <div className="sidebar__filter-chips">
        {SHOP_FILTERS.map((f) => (
          <button
            key={f}
            className={`sidebar__filter-chip${activeFilters.has(f) ? " sidebar__filter-chip--active" : ""}`}
            onClick={() => toggleFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="sidebar__filter-group">
        <span className="sidebar__filters-label">Price Range</span>
        <div className="sidebar__filter-chips">
          {PRICE_OPTIONS.map((p) => (
            <button
              key={p}
              className={`sidebar__filter-chip sidebar__filter-chip--price${activePrice === p ? " sidebar__filter-chip--active" : ""}`}
              onClick={() => selectPrice(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const Fallback = () => (
  <div className="sidebar__filters">
    <span className="sidebar__filters-label">Filter by</span>
    <div className="sidebar__filter-chips">
      {SHOP_FILTERS.map((f) => (
        <button key={f} className="sidebar__filter-chip">{f}</button>
      ))}
    </div>
    <div className="sidebar__filter-group">
      <span className="sidebar__filters-label">Price Range</span>
      <div className="sidebar__filter-chips">
        {PRICE_OPTIONS.map((p) => (
          <button key={p} className="sidebar__filter-chip sidebar__filter-chip--price">{p}</button>
        ))}
      </div>
    </div>
  </div>
);

export function SidebarFilterChips() {
  return (
    <Suspense fallback={<Fallback />}>
      <FilterChipsInner />
    </Suspense>
  );
}
