import { useCallback, useMemo, useState } from "react";
import { MAX_SHIPMENT_ORDERS, type MerchantOrder } from "@/util/api";

/**
 * Orders picked for the next shipment. Held in the page so the selection
 * survives switching tabs. Ids that stop being shippable (cancelled, shipped)
 * drop out automatically and never count toward the cap.
 */
export function useShipmentSelection(readyToShip: MerchantOrder[]) {
  const [rawIds, setRawIds] = useState<Set<number>>(new Set());

  const readyIds = useMemo(() => new Set(readyToShip.map((o) => o.id)), [readyToShip]);
  const selectedIds = useMemo(
    () => new Set([...rawIds].filter((id) => readyIds.has(id))),
    [rawIds, readyIds],
  );

  /** Select or unselect several orders; selecting stops at the cap. */
  const setSelected = useCallback((ids: number[], selected: boolean) => {
    setRawIds((prev) => {
      const next = new Set([...prev].filter((id) => readyIds.has(id)));
      for (const id of ids) {
        if (!selected) next.delete(id);
        else if (readyIds.has(id) && next.size < MAX_SHIPMENT_ORDERS) next.add(id);
      }
      return next;
    });
  }, [readyIds]);

  const toggle = useCallback(
    (id: number) => setSelected([id], !selectedIds.has(id)),
    [selectedIds, setSelected],
  );

  const clear = useCallback(() => setRawIds(new Set()), []);

  return {
    selectedIds,
    count: selectedIds.size,
    full: selectedIds.size >= MAX_SHIPMENT_ORDERS,
    toggle,
    setSelected,
    clear,
  };
}

export type ShipmentSelection = ReturnType<typeof useShipmentSelection>;
