"use client";

import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from "react";
import { cityQuery, type LocationValue } from "@/lib/pin-area";
import { placeById, suggestPlaces, type PlaceSuggestion } from "@/util/api/locations";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { Pin } from "@/util/geocode";
import styles from "./StreetSuggestInput.module.css";

// Wait for typing to settle before asking for suggestions.
const SUGGEST_DEBOUNCE_MS = 350;
const MIN_CHARS = 3;

const newSession = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onValueChange: (street: string) => void;
  /** The person picked a suggestion: the street text and the pin to place (not confirmed). */
  onPick: (street: string, pin: Pin) => void;
  /** The picked city and province narrow the search. */
  area: LocationValue;
};

/**
 * The street / house no. field with a dropdown of address suggestions. A pick
 * fills the street and places the map pin there; the person still confirms
 * the pin on the map. The location selects are not changed.
 */
export default function StreetSuggestInput({ value, onValueChange, onPick, area, className, ...input }: Props) {
  const { t } = useLanguage();
  const listId = useId();
  const [items, setItems] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Ask only after the person types, not for a saved address on load.
  const typedRef = useRef(false);
  const sessionRef = useRef(newSession());
  const seqRef = useRef(0);

  const context = cityQuery(area);
  const query = [value.trim(), context].filter(Boolean).join(", ");

  useEffect(() => {
    // Short text: the change handler already cleared the list.
    if (!typedRef.current || value.trim().length < MIN_CHARS) return;
    const seq = ++seqRef.current;
    const timer = window.setTimeout(async () => {
      try {
        const found = await suggestPlaces(query, sessionRef.current);
        if (seq !== seqRef.current) return;
        setItems(found);
        setActive(-1);
        setOpen(true);
      } catch {
        // No suggestions (outage, rate limit): the field still works as plain text.
        if (seq === seqRef.current) setItems([]);
      }
    }, SUGGEST_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, value]);

  const pick = async (item: PlaceSuggestion) => {
    const session = sessionRef.current;
    setOpen(false);
    setItems([]);
    typedRef.current = false;
    seqRef.current++;
    sessionRef.current = newSession();
    let center = item.center;
    if (!center) {
      try {
        center = (await placeById(item.id, session))?.center ?? null;
      } catch {
        center = null;
      }
    }
    if (center) onPick(item.title, { lng: center[0], lat: center[1] });
    else onValueChange(item.title);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || !items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      void pick(items[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const shown = open && items.length > 0;

  return (
    <span className={styles.wrap}>
      <input
        {...input}
        className={className}
        value={value}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => {
          typedRef.current = true;
          if (e.target.value.trim().length < MIN_CHARS) {
            seqRef.current++;
            setItems([]);
          }
          onValueChange(e.target.value);
        }}
        onFocus={() => {
          if (items.length) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {shown && (
        <span id={listId} role="listbox" aria-label={t.mapPin.suggestions} className={styles.list}>
          {items.map((item, i) => (
            <span
              key={item.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`${styles.option}${i === active ? ` ${styles.active}` : ""}`}
              // Keep the input focused so blur does not close the list before the pick.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void pick(item)}
            >
              <span className={styles.title}>{item.title}</span>
              {item.subtitle && <span className={styles.subtitle}>{item.subtitle}</span>}
            </span>
          ))}
          <span className={styles.hint}>{t.mapPin.suggestionsHint}</span>
        </span>
      )}
    </span>
  );
}
