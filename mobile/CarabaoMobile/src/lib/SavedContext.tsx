// CF-0104: saved produce (wishlist) ids shared by every screen that shows a heart.
// The server is the source of truth (/users/me/saved-produce/ids); a tap updates the
// heart at once and puts it back if the server refuses.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { Alert } from 'react-native';
import { useAuth } from './AuthContext';
import { api } from './api';
import { withSaved } from './savedProduce';
import { mustWipe, updateFor, valueFor, type Owned } from './ownedState';

interface SavedContextType {
  isSaved: (produceId: number) => boolean;
  /** Save or unsave. Resolves when the server has answered. */
  toggle: (produceId: number) => Promise<void>;
  /** Re-read the ids from the server (pull to refresh on the Saved screen). */
  reload: () => Promise<void>;
}

const SavedContext = createContext<SavedContextType | null>(null);
const NO_IDS: readonly number[] = [];

export function SavedProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  // CF-0108: keyed by user ID (the token is refreshed during a session); wiped on
  // sign-out or account switch.
  const owner = user?.id ?? null;
  const [loaded, setLoaded] = useState<Owned<readonly number[]>>(null);
  if (mustWipe(loaded, owner)) setLoaded(null);
  const ids = valueFor(loaded, owner, NO_IDS);

  const fetchIds = useCallback(
    (forToken: string, forOwner: string) =>
      api.saved
        .ids(forToken)
        .then((list) => setLoaded((prev) => (prev === null || prev.owner === forOwner ? { owner: forOwner, value: list } : prev)))
        .catch(() => { /* hearts stay empty; the next reload tries again */ }),
    [],
  );

  // Once per sign-in (not on every token refresh).
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);
  useEffect(() => {
    if (owner && tokenRef.current) void fetchIds(tokenRef.current, owner);
  }, [owner, fetchIds]);

  const reload = useCallback(
    () => (token && owner ? fetchIds(token, owner) : Promise.resolve()),
    [token, owner, fetchIds],
  );

  const toggle = useCallback(
    async (produceId: number) => {
      if (!token || !owner) return;
      const next = !ids.includes(produceId);
      const apply = (saved: boolean) =>
        setLoaded((prev) => updateFor(prev, owner, NO_IDS, (v) => withSaved(v, produceId, saved)));
      apply(next);
      try {
        if (next) await api.saved.save(token, produceId);
        else await api.saved.unsave(token, produceId);
      } catch (err) {
        apply(!next);
        // e.g. "You can save up to 200 items" or "You can't save your own listing".
        Alert.alert(next ? 'Not saved' : 'Not removed', err instanceof Error ? err.message : 'Please try again.');
      }
    },
    [token, owner, ids],
  );

  const value = useMemo<SavedContextType>(
    () => ({ isSaved: (id) => ids.includes(id), toggle, reload }),
    [ids, toggle, reload],
  );

  return <SavedContext.Provider value={value}>{children}</SavedContext.Provider>;
}

export function useSaved() {
  const ctx = useContext(SavedContext);
  if (!ctx) throw new Error('useSaved must be used inside SavedProvider');
  return ctx;
}
