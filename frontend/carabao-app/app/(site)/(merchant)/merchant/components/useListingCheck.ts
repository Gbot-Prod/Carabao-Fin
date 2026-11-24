import { useEffect, useState } from "react";
import { checkProduce, type ProduceCheckResult } from "@/util/api";
import { CHECK_DELAY_MS } from "@/lib/listing-checks";
import { formToPayload, type ProduceFormState } from "./ProduceFormFields";

/**
 * Guardrails Phase 1: the checker's result for the form as it is now.
 * Checks CHECK_DELAY_MS after the last change; a newer change cancels the
 * request in flight. A failed check shows nothing: the save checks again.
 */
export default function useListingCheck(
  form: ProduceFormState,
  produceId: number | null,
  enabled: boolean,
): ProduceCheckResult | null {
  const [result, setResult] = useState<ProduceCheckResult | null>(null);
  const payload = JSON.stringify(enabled ? checkPayload(form, produceId) : null);

  useEffect(() => {
    if (payload === "null") return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      checkProduce(JSON.parse(payload), controller.signal)
        .then((r) => {
          if (!controller.signal.aborted) setResult(r);
        })
        .catch(() => {
          if (!controller.signal.aborted) setResult(null);
        });
    }, CHECK_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [payload]);

  return enabled ? result : null;
}

function checkPayload(form: ProduceFormState, produceId: number | null) {
  const p = formToPayload(form);
  // Leave out what the merchant has not filled in yet: no messages for it.
  return {
    produce_id: produceId,
    name: p.name.trim() || null,
    description: p.description,
    category: p.category,
    price: p.price > 0 ? p.price : null,
    unit: p.unit,
    unit_quantity: p.unit_quantity && p.unit_quantity > 0 ? p.unit_quantity : null,
    stock_quantity: p.stock_quantity,
    harvest_date: p.harvest_date || null,
    best_before: p.best_before || null,
    min_order_qty: p.min_order_qty,
    price_tiers: (p.price_tiers ?? []).filter((t) => t.min_qty >= 2 && t.unit_price >= 1),
  };
}
