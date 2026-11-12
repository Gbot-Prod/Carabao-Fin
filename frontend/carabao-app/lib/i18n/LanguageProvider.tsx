"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import en, { type Strings } from "./strings/en";
import fil from "./strings/fil";
import { LANGUAGE_TOGGLE_ENABLED } from "@/lib/features";

// English / Filipino UI (L1). The choice is a per-browser convenience, so it lives
// in localStorage; the page always renders in English first and switches after
// mount, so server and client HTML match.

export type Language = "en" | "fil";

const STRINGS: Record<Language, Strings> = { en, fil };
const STORAGE_KEY = "carabao.lang";

type LanguageContextValue = {
  lang: Language;
  setLang: (lang: Language) => void;
  t: Strings;
};

const LanguageContext = createContext<LanguageContextValue>({
  lang: "en",
  setLang: () => {},
  t: en,
});

function readSaved(): Language | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "en" || saved === "fil" ? saved : null;
  } catch {
    return null;
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>("en");

  useEffect(() => {
    // With the toggle switched off, ignore a Filipino choice saved earlier.
    if (!LANGUAGE_TOGGLE_ENABLED) return;
    const saved = readSaved();
    if (saved && saved !== "en") queueMicrotask(() => setLangState(saved));
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
  }, []);

  const value = useMemo(() => ({ lang, setLang, t: STRINGS[lang] }), [lang, setLang]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** The current language's strings and a setter: `const { t } = useLanguage()`. */
export function useLanguage() {
  return useContext(LanguageContext);
}
