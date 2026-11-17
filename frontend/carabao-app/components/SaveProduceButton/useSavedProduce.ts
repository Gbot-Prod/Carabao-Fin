"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useAuthPrompt } from "@/components/AuthPrompt/AuthPromptContext";
import { withSaved } from "@/lib/saved-produce";
import { fetchSavedProduceIds, saveProduce, unsaveProduce } from "@/util/api/savedProduce";

/**
 * Saved produce ids for the signed-in buyer (CF-0038), loaded once per mount.
 * `toggle` updates at once and undoes the change if the request fails; a
 * signed-out visitor gets the sign-in prompt instead.
 */
export function useSavedProduce() {
  const { isAuthenticated } = useAuth();
  const { showPrompt } = useAuthPrompt();
  const [ids, setIds] = useState<number[]>([]);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchSavedProduceIds()
      .then(setIds)
      .catch(() => setIds([]));
  }, [isAuthenticated]);

  const toggle = useCallback(
    async (produceId: number) => {
      if (!isAuthenticated) {
        showPrompt();
        return;
      }
      const wasSaved = ids.includes(produceId);
      setBusy(produceId);
      setIds((prev) => withSaved(prev, produceId, !wasSaved));
      try {
        if (wasSaved) await unsaveProduce(produceId);
        else await saveProduce(produceId);
      } catch {
        setIds((prev) => withSaved(prev, produceId, wasSaved));
      } finally {
        setBusy(null);
      }
    },
    [ids, isAuthenticated, showPrompt],
  );

  return {
    isSaved: (produceId: number) => ids.includes(produceId),
    isBusy: (produceId: number) => busy === produceId,
    toggle,
  };
}
