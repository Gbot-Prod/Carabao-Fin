// src/lib/MerchantContext.tsx
// CF-0120: the merchant app's root gate (plan §4.3). One /users/me call per
// signed-in account tells the gate whether the account has a farm; nothing that
// calls /merchants/me/* is mounted before it says `allowed`.
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { api, type ApiUserProfile } from './api';
import { useAuth } from './AuthContext';
import { decideAccess, type Access, type MerchantCheck } from './access';

interface MerchantGateValue {
  /** wait | signin | allowed | forbidden | error (see access.ts). */
  status: Access;
  /** /users/me for the signed-in account once the gate has it, else null. */
  profile: ApiUserProfile | null;
  /** Check again after `error`. */
  retry: () => void;
}

const MerchantContext = createContext<MerchantGateValue | null>(null);

export function MerchantProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, token, user } = useAuth();
  // The context token is refreshed about every minute. Keep the latest in a ref
  // so a new token does not run the check again (one call per user).
  const tokenRef = useRef(token);
  useEffect(() => { tokenRef.current = token; }, [token]);

  // Keyed by user + attempt, so another account or a retry checks again.
  const key = isAuthenticated ? `${user?.id ?? ''}` : '';
  const [check, setCheck] = useState<{ key: string; value: MerchantCheck; profile: ApiUserProfile | null }>(
    { key: '', value: 'idle', profile: null },
  );
  const [attempt, setAttempt] = useState(0);
  const attemptKey = `${key}|${attempt}`;

  useEffect(() => {
    if (!key) return;
    let active = true;
    const k = `${key}|${attempt}`;
    api.users
      .me(tokenRef.current)
      .then((p) => {
        if (active) setCheck({ key: k, value: { isMerchant: !!p.merchant }, profile: p });
      })
      .catch(() => {
        if (active) setCheck({ key: k, value: 'error', profile: null });
      });
    return () => { active = false; };
  }, [key, attempt]);

  const current = check.key === attemptKey ? check : null;
  const merchant: MerchantCheck = current?.value ?? 'idle';
  const status = decideAccess({ isLoading, isAuthenticated }, 'merchant', merchant);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo<MerchantGateValue>(
    () => ({ status, profile: current?.profile ?? null, retry }),
    [status, current, retry],
  );

  return <MerchantContext.Provider value={value}>{children}</MerchantContext.Provider>;
}

/** The root gate's state. Only valid under `MerchantProvider`. */
export function useMerchantGate(): MerchantGateValue {
  const gate = useContext(MerchantContext);
  if (!gate) throw new Error('useMerchantGate must be used inside MerchantProvider');
  return gate;
}
