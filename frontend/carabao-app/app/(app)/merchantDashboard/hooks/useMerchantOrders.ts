import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchMyMerchantOrders, type MerchantOrder } from "@/util/api";

// Matches SHIPPABLE_ORDER_STATUSES in backend/app/api/routes/shipments.py:
// paid and confirmed, and not already on a route.
export const isReadyToShip = (o: MerchantOrder) =>
  o.status === "processing" && !o.shipped && o.shipment_id == null;

/**
 * Merchant orders, fetched once `enabled` is true and kept afterwards.
 * Lives in the page (not a tab) because the Orders and Shipments tabs both
 * read it, and the tab bar shows counts from it.
 */
export function useMerchantOrders(enabled: boolean) {
  const [orders, setOrders] = useState<MerchantOrder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOrders(await fetchMyMerchantOrders());
      setLoaded(true);
    } catch {
      setError("Failed to load orders. Please refresh the tab.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled || loaded) return;
    void reload();
  }, [enabled, loaded, reload]);

  const replaceOrder = useCallback((updated: MerchantOrder) => {
    setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
  }, []);

  const readyToShip = useMemo(() => orders.filter(isReadyToShip), [orders]);

  return { orders, readyToShip, loaded, loading, error, reload, replaceOrder };
}

export type MerchantOrdersState = ReturnType<typeof useMerchantOrders>;
