// CF-0052 (B19): farms the buyer opened recently, kept in this browser only
// (localStorage). Per-viewer convenience: a missing or blocked storage just
// means an empty list.

export type RecentFarm = {
  id: number;
  name: string;
  town: string | null;
  logo: string | null;
  viewedAt: number; // ms since epoch
};

export const RECENT_FARMS_KEY = "carabao.recentFarms";
export const RECENT_FARMS_MAX = 8;

/** Put `farm` first, drop its older entry, keep at most RECENT_FARMS_MAX. */
export function addRecentFarm(list: RecentFarm[], farm: RecentFarm): RecentFarm[] {
  return [farm, ...list.filter((f) => f.id !== farm.id)].slice(0, RECENT_FARMS_MAX);
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** The stored list, with anything malformed (old shape, edited by hand) dropped. */
export function parseRecentFarms(raw: string | null): RecentFarm[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: RecentFarm[] = [];
  const seen = new Set<number>();
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = r.id;
    const name = str(r.name);
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0 || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name,
      town: str(r.town),
      // Only our own image URLs: https, or a site path.
      logo: typeof r.logo === "string" && /^(https:\/\/|\/)/.test(r.logo) ? r.logo : null,
      viewedAt: typeof r.viewedAt === "number" && Number.isFinite(r.viewedAt) ? r.viewedAt : 0,
    });
    if (out.length === RECENT_FARMS_MAX) break;
  }
  return out;
}

type ReadStore = Pick<Storage, "getItem">;
type WriteStore = Pick<Storage, "getItem" | "setItem">;

export function readRecentFarms(store: ReadStore | null): RecentFarm[] {
  try {
    return parseRecentFarms(store?.getItem(RECENT_FARMS_KEY) ?? null);
  } catch {
    return [];
  }
}

/** Save a visit; returns false when storage is blocked or full. */
export function rememberFarm(store: WriteStore | null, farm: RecentFarm): boolean {
  if (!store) return false;
  try {
    const next = addRecentFarm(readRecentFarms(store), farm);
    store.setItem(RECENT_FARMS_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

