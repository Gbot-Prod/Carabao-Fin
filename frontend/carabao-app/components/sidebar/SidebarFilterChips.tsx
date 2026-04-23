"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export const SHOP_FILTERS = ["Drinks", "Food", "Popular", "Nearby", "Fast Delivery"];

function FilterChipsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeFilters = new Set(
    (searchParams.get("filters") ?? "").split(",").filter(Boolean)
  );

  const toggleFilter = (filter: string) => {
    const next = new Set(activeFilters);
    next.has(filter) ? next.delete(filter) : next.add(filter);
    const params = new URLSearchParams();
    if (next.size > 0) params.set("filters", Array.from(next).join(","));
    const qs = params.toString();
    router.push(qs ? `/order?${qs}` : "/order");
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
    </div>
  );
}

export function SidebarFilterChips() {
  return (
    <Suspense
      fallback={
        <div className="sidebar__filters">
          <span className="sidebar__filters-label">Filter by</span>
          <div className="sidebar__filter-chips">
            {SHOP_FILTERS.map((f) => (
              <button key={f} className="sidebar__filter-chip">{f}</button>
            ))}
          </div>
        </div>
      }
    >
      <FilterChipsInner />
    </Suspense>
  );
}
