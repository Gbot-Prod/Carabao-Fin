"use client";

import { useCallback, useRef } from "react";
import { fillText } from "@/lib/pin-autofill";

/**
 * Free-text autofill from the map pin. Returns the field's new value: the
 * pin's text when the field is empty or still holds the last pin's text,
 * else what the person typed. One instance per form; `key` names the field.
 */
export function usePinAutofill() {
  const last = useRef<Record<string, string>>({});
  return useCallback((key: string, current: string, next: string | null | undefined) => {
    const value = fillText(current, next, last.current[key] ?? null);
    if (value !== current) last.current[key] = value;
    return value;
  }, []);
}
