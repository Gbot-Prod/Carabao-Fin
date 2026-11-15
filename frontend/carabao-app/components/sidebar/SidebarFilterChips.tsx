"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export const SHOP_FILTERS = [
  "Fruits",
  "Veggies",
  // "Popular",
  // "Nearby",
  // "Fast Delivery",
];

function FilterChipsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeFilters = new Set(
    (searchParams.get("filters") ?? "").split(",").filter(Boolean)
  );

  const buildUrl = (filters: Set<string>) => {
    const params = new URLSearchParams();
    if (filters.size > 0) params.set("filters", Array.from(filters).join(","));
    const qs = params.toString();
    return qs ? `/order?${qs}` : "/order";
  };

  const toggleFilter = (filter: string) => {
    const next = new Set(activeFilters);
    if (next.has(filter)) next.delete(filter);
    else next.add(filter);
    router.push(buildUrl(next));
  };

  return (
    <div className="sidebar__filters">
      <span className="sidebar__filters-label">Filter by</span>
      <div className="sidebar__filter-checklist">
        {SHOP_FILTERS.map((f) => (
          <label
            key={f}
            className="sidebar__filter-check-item"
          >
            <input
              type="checkbox"
              checked={activeFilters.has(f)}
              onChange={() => toggleFilter(f)}
              className="sidebar__filter-checkbox"
            />
            {f}
          </label>
        ))}
      </div>
    </div>
  );
}

const Fallback = () => (
  <div className="sidebar__filters">
    <span className="sidebar__filters-label">Filter by</span>
    <div className="sidebar__filter-checklist">
      {SHOP_FILTERS.map((f) => (
        <label key={f} className="sidebar__filter-check-item">
          <input type="checkbox" className="sidebar__filter-checkbox" />
          {f}
        </label>
      ))}
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
