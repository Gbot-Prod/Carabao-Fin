// CF-0104: saved produce (wishlist) ids shared by every screen that shows a heart.
// The server is the source of truth (/users/me/saved-produce/ids); a tap updates the
// heart at once and puts it back if the server refuses.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { Alert } from 'react-native';
import { useAuth } from './AuthContext';
import { api } from './api';
import { idsFor, withSaved } from './savedProduce';

interface SavedContextType {
  isSaved: (produceId: number) => boolean;
  /** Save or unsave. Resolves when the server has answered. */
  toggle: (produceId: number) => Promise<void>;
  /** Re-read the ids from the server (pull to refresh on the Saved screen). */
  reload: () => Promise<void>;
}

const SavedContext = createContext<SavedContextType | null>(null);

export function SavedProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [loaded, setLoaded] = useState<{ token: string; ids: readonly number[] } | null>(null);
  const ids = idsFor(loaded, token);

  const fetchIds = useCallback(
    (forToken: string) =>
      api.saved
        .ids(forToken)
        .then((list) => setLoaded({ token: forToken, ids: list }))
        .catch(() => { /* hearts stay empty; the next reload tries again */ }),
    [],
  );

  useEffect(() => {
    if (token) void fetchIds(token);
  }, [token, fetchIds]);

  const reload = useCallback(() => (token ? fetchIds(token) : Promise.resolve()), [token, fetchIds]);

  const toggle = useCallback(
    async (produceId: number) => {
      if (!token) return;
      const next = !ids.includes(produceId);
      const apply = (saved: boolean) =>
        setLoaded((prev) => ({
          token,
          ids: withSaved(prev?.token === token ? prev.ids : [], produceId, saved),
        }));
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
    [token, ids],
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
