// src/components/StreetSuggestInput.tsx
// The street field with a list of address suggestions under it (web
// components/StreetSuggestInput). A pick fills the street and places the map pin there; the
// merchant still confirms the pin on the map. The location selects are not changed.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { api, type PlaceSuggestion } from '../lib/api';
import { cityQuery } from '../lib/pinLocation';
import { Colors, FontSize, Radius, Spacing } from '../lib/theme';

const SUGGEST_DEBOUNCE_MS = 350;
const MIN_CHARS = 3;

const newSession = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

type Pin = { lat: number; lng: number };

type Props = Omit<TextInputProps, 'value' | 'onChangeText'> & {
  value: string;
  onChangeText: (street: string) => void;
  /** The merchant picked a suggestion: the street text and the pin (not confirmed). */
  onPick: (street: string, pin: Pin) => void;
  /** The picked city and province narrow the search. */
  area: { province?: string; city?: string };
  token: string | null;
};

export default function StreetSuggestInput({ value, onChangeText, onPick, area, token, ...input }: Props) {
  const [items, setItems] = useState<PlaceSuggestion[]>([]);
  // Ask only after the merchant types, not for a saved address on load.
  const typedRef = useRef(false);
  const sessionRef = useRef(newSession());
  const seqRef = useRef(0);

  const query = [value.trim(), cityQuery(area)].filter(Boolean).join(', ');

  useEffect(() => {
    // Short text: the change handler already cleared the list.
    if (!token || !typedRef.current || value.trim().length < MIN_CHARS) return;
    const seq = ++seqRef.current;
    const timer = setTimeout(() => {
      api.locations.suggest(token, query, sessionRef.current).then(
        (found) => {
          if (seq === seqRef.current) setItems(found);
        },
        // No suggestions (outage, rate limit): the field still works as plain text.
        () => {
          if (seq === seqRef.current) setItems([]);
        },
      );
    }, SUGGEST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, value, token]);

  const pick = async (item: PlaceSuggestion) => {
    const session = sessionRef.current;
    setItems([]);
    typedRef.current = false;
    seqRef.current++;
    sessionRef.current = newSession();
    let center = item.center;
    if (!center) {
      try {
        center = (await api.locations.place(token, item.id, session))?.center ?? null;
      } catch {
        center = null;
      }
    }
    if (center) onPick(item.title, { lng: center[0], lat: center[1] });
    else onChangeText(item.title);
  };

  return (
    <View>
      <TextInput
        {...input}
        value={value}
        autoComplete="off"
        onChangeText={(text) => {
          typedRef.current = true;
          if (text.trim().length < MIN_CHARS) {
            seqRef.current++;
            setItems([]);
          }
          onChangeText(text);
        }}
      />
      {items.length > 0 && (
        <View style={styles.list} accessibilityRole="menu" accessibilityLabel="Address suggestions">
          {items.map((item) => (
            <Pressable
              key={item.id}
              style={({ pressed }) => [styles.option, pressed ? styles.pressed : null]}
              onPress={() => void pick(item)}
              accessibilityRole="menuitem"
              accessibilityLabel={item.subtitle ? `${item.title}, ${item.subtitle}` : item.title}
            >
              <Text style={styles.title}>{item.title}</Text>
              {item.subtitle ? <Text style={styles.subtitle}>{item.subtitle}</Text> : null}
            </Pressable>
          ))}
          <Text style={styles.hint}>Select an address to put the pin there.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    marginTop: 4, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    backgroundColor: Colors.white, overflow: 'hidden',
  },
  option: { paddingHorizontal: Spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  pressed: { backgroundColor: Colors.surfaceAlt },
  title: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '600' },
  subtitle: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  hint: { fontSize: FontSize.xs, color: Colors.textLight, paddingHorizontal: Spacing.md, paddingVertical: 6 },
});
