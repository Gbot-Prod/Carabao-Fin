// src/components/AddressPinMap.tsx
// S13 (plan §5.8): the address form's map pin, drawn with react-native-maps. The web's
// MapPinPicker (frontend/carabao-app/components/MapPinPicker) is the same behaviour: the map
// stays locked until region to street is filled in, the typed address places the first pin, and
// a tap or a drag moves it. The pin never rewrites the typed address; instead a pin in another
// city is flagged for the person to check (src/lib/pinLocation.ts pinAreaMismatch).
// Every new pin is checked for a road near it (pin quality, control 5): a second marker shows
// where the rider stops, and a pin with no road, or with rider reports near it, is reported
// before the form is saved. Geocoding and the check go through the API (api.locations), so the
// map provider's server key stays on the server and the app never sees it.
// AddressPinMap.web.tsx replaces this file in the browser preview (`npm run web`), where
// react-native-maps has no implementation.
// Decision D3: Google Maps (Android, and iOS when EXPO_PUBLIC_MAP_PROVIDER is google) draws only
// with a key (app.config.ts passes EXPO_PUBLIC_GOOGLE_MAPS_KEY to the plugin); without one the
// note stands in for the map. src/lib/mapProvider.ts has the switch.
// The web's "Use my location" button is left out: reading the phone's position needs a location
// module the app does not ship (expo-location). The map's own location button still shows the
// person's dot, and a tap or a drag places the pin.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { ApiError, api, type PinCheckResult } from '../lib/api';
import {
  ADDRESS_DEBOUNCE_MS,
  addressComplete,
  addressHit,
  addressQuery,
  cityFits,
  cityQuery,
  DEFAULT_PIN_CENTER,
  DEFAULT_PIN_ZOOM,
  PIN_COLOR,
  PIN_WORDS,
  pinAreaMismatch,
  PIN_MAP_KEY_NOTE,
  pinMismatchText,
  placeHints,
  resolvePinLocation,
  ROAD_COLOR,
  ROAD_MARKER_MIN_M,
  roadNoteText,
  samePin,
  type LocationValue,
  type Pin,
  type TypedAddress,
} from '../lib/pinLocation';
import { MAP_AVAILABLE, USE_GOOGLE_MAPS } from '../lib/nativeMap';
import { Colors, FontSize, Radius, Spacing } from '../lib/theme';
import { MapUnavailable } from './MapUnavailable';

/** Google Maps needs a key; Apple Maps does not (decision D3, src/lib/mapProvider.ts). */

/** Close in on a pin the person placed by hand (about a street's length across). */
const FOCUS_ZOOM = 16;

/** react-native-maps wants the view's width and height, not a zoom level. */
function regionAround(pin: Pin, zoom: number) {
  const delta = 360 / 2 ** zoom;
  return { latitude: pin.lat, longitude: pin.lng, latitudeDelta: delta, longitudeDelta: delta };
}

/** The app keeps a pin as `{ lat, lng }`; react-native-maps calls the same pair `{ latitude, longitude }`. */
function toCoordinate(pin: Pin) {
  return { latitude: pin.lat, longitude: pin.lng };
}

function toPin(at: { latitude: number; longitude: number }): Pin {
  return { lat: at.latitude, lng: at.longitude };
}

/** What reverse geocoding found at the current pin (web MapPinPicker's Area). */
type Area = { pin: Pin; placeName: string | null; location: LocationValue | null };

/** The road check's states (web MapPinPicker's Check). Each one names the pin it is about, so a
 * pin that moved never shows the previous pin's answer. */
type Check =
  | { state: 'idle' }
  | { state: 'checking'; pin: Pin }
  | { state: 'ok'; pin: Pin; result: PinCheckResult }
  | { state: 'error'; pin: Pin; message: string };

export type AddressPinMapProps = {
  /**
   * The typed address. The map stays locked until it is complete (src/lib/pinLocation.ts
   * addressComplete); then the address places the first pin and follows edits until the person
   * moves the pin.
   */
  address: TypedAddress;
  /** The pin, or null when there is none yet. */
  pin: Pin | null;
  /** The person placed or confirmed this pin; a pin the address suggested is not confirmed. */
  confirmed: boolean;
  /** A tap, a drag or the confirm button: the pin, and whether a person placed it. */
  onChange: (pin: Pin, confirmed: boolean) => void;
  /** The signed-in token; both geocoding calls and the pin check need it. */
  token: string | null;
  /** Shown under the map, e.g. when saving with no pin or an unconfirmed one. */
  error?: string | null;
};

export default function AddressPinMap({
  address, pin, confirmed, onChange, token, error = null,
}: AddressPinMapProps) {
  const mapRef = useRef<MapView | null>(null);
  const onChangeRef = useRef(onChange);
  const pinRef = useRef(pin);
  // The pin the address last placed; while the value is still this pin, address edits move it.
  // Once the person moves the pin, it stays where they put it.
  const autoPinRef = useRef<Pin | null>(null);
  const autoZoomRef = useRef<number | null>(null);
  // The last pin the map itself reported, so its effect does not pan to where the person tapped.
  const lastMapPin = useRef<Pin | null>(null);
  // Only the newest pin's answers are used; a quick second drag wins.
  const seqRef = useRef(0);
  const [ready, setReady] = useState(false);
  // The pin shown as "suggested by the address" in the note under the map.
  const [autoPin, setAutoPin] = useState<Pin | null>(null);
  // Mapbox found neither the address nor the barangay: the person places the pin.
  const [notFound, setNotFound] = useState(false);
  const [area, setArea] = useState<Area | null>(null);
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  // The map's current zoom, so a pin placed by hand never zooms the person out.
  const zoomRef = useRef(FOCUS_ZOOM);

  useEffect(() => {
    onChangeRef.current = onChange;
    pinRef.current = pin;
  }, [onChange, pin]);

  const runCheck = useCallback(async (at: Pin, seq: number) => {
    if (!token) return;
    setCheck({ state: 'checking', pin: at });
    try {
      const result = await api.locations.pinCheck(token, at);
      if (seq === seqRef.current) setCheck({ state: 'ok', pin: at, result });
    } catch (caught) {
      if (seq !== seqRef.current) return;
      const status = caught instanceof ApiError ? caught.status : 0;
      // 422: no road near the pin (the backend refuses it); 400: its own words say why.
      if (status === 422) setCheck({ state: 'error', pin: at, message: PIN_WORDS.noRoad });
      else if (status === 400) {
        setCheck({ state: 'error', pin: at, message: caught instanceof ApiError ? caught.message : PIN_WORDS.noRoad });
      }
      // Anything else (offline, rate limit): the save checks again, so stay quiet.
      else setCheck({ state: 'idle' });
    }
  }, [token]);

  const lookUpArea = useCallback(async (at: Pin, seq: number) => {
    let found: Area = { pin: at, placeName: null, location: null };
    if (token) {
      try {
        const feature = await api.locations.reverseGeocode(token, at);
        found = {
          pin: at,
          placeName: feature?.place_name ?? null,
          location: await resolvePinLocation(placeHints(feature)),
        };
      } catch {
        // No area check without geocoding; the pin itself still counts.
      }
    }
    if (seq === seqRef.current) setArea(found);
  }, [token]);

  /** The person placed the pin: a tap, a drag, or the confirm button. */
  const place = useCallback((next: Pin) => {
    lastMapPin.current = next;
    onChangeRef.current(next, true);
  }, []);

  // Each new pin, whoever set it (the person, the address, a saved address): show it, check the
  // road near it, and look up its area.
  const lat = pin?.lat;
  const lng = pin?.lng;
  useEffect(() => {
    if (lat == null || lng == null) {
      // Nothing to check; the render below reads `pin` and shows no notes without one.
      seqRef.current += 1;
      return;
    }
    const map = mapRef.current;
    if (!ready || !map) return;
    const at = { lat, lng };
    const seq = ++seqRef.current;
    if (!samePin(at, lastMapPin.current)) {
      const zoom = autoZoomRef.current ?? Math.max(zoomRef.current, FOCUS_ZOOM);
      map.animateToRegion(regionAround(at, zoom), 300);
    }
    void runCheck(at, seq);
    void lookUpArea(at, seq);
  }, [ready, lat, lng, runCheck, lookUpArea]);

  // Place the pin from the typed address while there is no pin, or while the pin is still the
  // one the address placed. A street that matches in another city is retried without it.
  const query = addressQuery(address);
  const streetlessQuery = addressQuery(address, false);
  const areaQuery = cityQuery(address);
  const typedCity = address.city;
  useEffect(() => {
    if (!ready || !token || !query) return;
    const following = () => !pinRef.current || samePin(pinRef.current, autoPinRef.current);
    if (!following()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          let hit = addressHit(await api.locations.geocode(token, query));
          if ((!hit || !cityFits(hit.hints.city, typedCity)) && streetlessQuery && streetlessQuery !== query) {
            hit = addressHit(await api.locations.geocode(token, streetlessQuery));
          }
          if (cancelled || !following()) return;
          if (hit && cityFits(hit.hints.city, typedCity)) {
            setNotFound(false);
            autoPinRef.current = hit.pin;
            autoZoomRef.current = hit.zoom;
            setAutoPin(hit.pin);
            onChangeRef.current(hit.pin, false);
            return;
          }
          // Not found: no suggested pin. Show the city so the person can place it.
          setNotFound(true);
          const cityHit = areaQuery ? addressHit(await api.locations.geocode(token, areaQuery)) : null;
          if (!cancelled && cityHit) mapRef.current?.animateToRegion(regionAround(cityHit.pin, cityHit.zoom), 300);
        } catch {
          // Geocoding is down: no suggestion; the person places the pin.
          if (!cancelled) setNotFound(true);
        }
      })();
    }, ADDRESS_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, token, query, streetlessQuery, areaQuery, typedCity]);

  const unlocked = addressComplete(address);

  // Decision D3: no Google Maps key on Android, or a broken answer: say so instead of a blank box.
  if (!MAP_AVAILABLE) return <MapUnavailable note={PIN_MAP_KEY_NOTE} />;

  if (!unlocked) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>{PIN_WORDS.label}</Text>
        <Text style={styles.locked}>{PIN_WORDS.locked}</Text>
      </View>
    );
  }

  // Geocoding and the pin check go through the API, so a signed-out form cannot place a pin.
  if (!token) return <Text style={styles.note}>{PIN_WORDS.unavailable}</Text>;

  const currentArea = pin && area && samePin(area.pin, pin) ? area : null;
  const mismatch = currentArea
    ? pinAreaMismatch(currentArea.location, { province: address.province, city: address.city })
    : null;
  // Placed from the address in this visit, or a saved pin nobody placed by hand.
  const fromAddress = !!pin && (samePin(pin, autoPin) || !confirmed);

  // Only the current pin's answer is shown: a pin that moved waits for its own check.
  const shownCheck: Check = pin && check.state !== 'idle' && samePin(check.pin, pin)
    ? check
    : { state: 'idle' };

  let checkNote: { text: string; tone: 'info' | 'warn' | 'error' } | null = null;
  if (shownCheck.state === 'checking') checkNote = { text: PIN_WORDS.checking, tone: 'info' };
  else if (shownCheck.state === 'error') checkNote = { text: shownCheck.message, tone: 'error' };
  else if (shownCheck.state === 'ok') {
    const result = shownCheck.result;
    if (result.blocked) checkNote = { text: PIN_WORDS.blocked, tone: 'error' };
    else if (result.unreachable_reports > 0) checkNote = { text: PIN_WORDS.reported, tone: 'warn' };
    else if (result.road_distance_m != null && result.road_distance_m >= ROAD_MARKER_MIN_M) {
      checkNote = { text: roadNoteText(result.road_distance_m), tone: 'info' };
    } else if (result.road_distance_m != null) checkNote = { text: PIN_WORDS.onRoad, tone: 'info' };
  }
  const toneStyle = checkNote?.tone === 'error' ? styles.error : checkNote?.tone === 'warn' ? styles.warn : styles.info;

  // Where the rider stops, when that is at least a few metres off the pin.
  const road = shownCheck.state === 'ok' ? shownCheck.result : null;
  const roadFar = !!road && road.road_lat != null && road.road_lng != null
    && (road.road_distance_m ?? 0) >= ROAD_MARKER_MIN_M;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.label}>{PIN_WORDS.label}</Text>
        {shownCheck.state === 'checking' ? <ActivityIndicator size="small" color={Colors.textMuted} /> : null}
      </View>

      <View style={styles.notice} accessibilityRole="text">
        <Text style={styles.noticeIcon} importantForAccessibility="no">!</Text>
        <View style={styles.noticeText}>
          <Text style={styles.noticeTitle}>{PIN_WORDS.noticeTitle}</Text>
          <Text style={styles.noticeBody}>{PIN_WORDS.noticeBody}</Text>
        </View>
      </View>

      <View style={[styles.mapWrap, error ? styles.mapInvalid : null]}>
        <MapView
          ref={mapRef}
          provider={USE_GOOGLE_MAPS ? PROVIDER_GOOGLE : undefined}
          style={styles.map}
          initialRegion={regionAround(pin ?? DEFAULT_PIN_CENTER, pin ? FOCUS_ZOOM : DEFAULT_PIN_ZOOM)}
          onMapReady={() => setReady(true)}
          onRegionChangeComplete={(region) => {
            zoomRef.current = Math.log2(360 / Math.max(region.latitudeDelta, 1e-6));
          }}
          onPress={(event) => place(toPin(event.nativeEvent.coordinate))}
          // The phone's own location button, where the map provider draws one (no extra module).
          showsUserLocation
          showsMyLocationButton
          toolbarEnabled={false}
          accessibilityLabel={PIN_WORDS.mapLabel}
        >
          {pin ? (
            <Marker
              coordinate={toCoordinate(pin)}
              draggable
              onDragEnd={(event) => place(toPin(event.nativeEvent.coordinate))}
              pinColor={PIN_COLOR}
              title={PIN_WORDS.label}
            />
          ) : null}
          {roadFar && road?.road_lat != null && road.road_lng != null ? (
            <Marker
              coordinate={toCoordinate({ lat: road.road_lat, lng: road.road_lng })}
              pinColor={ROAD_COLOR}
              title={PIN_WORDS.roadMarker}
            />
          ) : null}
        </MapView>
      </View>

      <Text style={styles.note}>
        {!pin
          ? notFound ? PIN_WORDS.notFound : PIN_WORDS.hint
          : fromAddress ? PIN_WORDS.fromAddress : currentArea?.placeName ?? PIN_WORDS.pinned}
      </Text>

      {pin && !confirmed ? (
        <TouchableOpacity style={styles.confirm} onPress={() => place(pin)} accessibilityRole="button">
          <Text style={styles.confirmText}>{PIN_WORDS.confirmPin}</Text>
        </TouchableOpacity>
      ) : null}
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      {mismatch ? <Text style={styles.warn} accessibilityRole="alert">{pinMismatchText(mismatch)}</Text> : null}
      {checkNote ? <Text style={toneStyle} accessibilityRole={checkNote.tone === 'info' ? 'text' : 'alert'}>{checkNote.text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: Spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  label: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600' },
  notice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    padding: Spacing.sm, marginBottom: Spacing.sm,
    borderRadius: Radius.md, borderWidth: 1, borderColor: '#f3d9a4', backgroundColor: Colors.warningBg,
  },
  noticeIcon: {
    width: 20, height: 20, borderRadius: 10, overflow: 'hidden',
    backgroundColor: '#c2410c', color: Colors.white,
    textAlign: 'center', fontSize: FontSize.xs, fontWeight: '800', lineHeight: 20,
  },
  noticeText: { flex: 1 },
  noticeTitle: { fontSize: FontSize.sm, fontWeight: '700', color: '#b45309' },
  noticeBody: { fontSize: FontSize.xs, color: '#6b4a1a', lineHeight: 17, marginTop: 2 },
  mapWrap: {
    borderRadius: Radius.lg, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceAlt,
  },
  mapInvalid: { borderWidth: 1.5, borderColor: Colors.error },
  map: { width: '100%', height: 240 },
  note: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: Spacing.xs, lineHeight: 17 },
  info: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 4 },
  warn: { fontSize: FontSize.xs, color: Colors.warning, marginTop: 4 },
  error: { fontSize: FontSize.xs, color: Colors.error, marginTop: 4 },
  locked: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt, padding: Spacing.md,
    fontSize: FontSize.xs, color: Colors.textMuted, lineHeight: 17,
  },
  confirm: {
    marginTop: Spacing.sm, minHeight: 44, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.primary,
  },
  confirmText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primaryDark },
});
