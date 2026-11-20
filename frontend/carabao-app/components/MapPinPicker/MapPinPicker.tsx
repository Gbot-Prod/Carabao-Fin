"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type mapboxgl from "mapbox-gl";
import { reverseGeocode, type Pin, type PinAddress } from "@/util/reverseGeocode";
import { resolvePinLocation } from "@/util/pinLocation";
import type { LocationValue } from "@/lib/pin-autofill";
import { checkPin, type PinCheckResult } from "@/util/api";
import getApiErrorMessage, { getApiErrorStatus } from "@/util/errorHelper";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { fmt } from "@/lib/i18n/format";
import styles from "./MapPinPicker.module.css";

// Metro Manila, the default view before anything is pinned.
const DEFAULT_CENTER: [number, number] = [120.9842, 14.5995];
// The road marker is shown only when the road point is this far from the pin.
const ROAD_MARKER_MIN_M = 5;
const PIN_COLOR = "#277a4d";
const ROAD_COLOR = "#173d25";

/** What the pin tells the form: address text plus the select values it resolved. */
export type PinFound = PinAddress & { location: LocationValue | null };

type Check =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; result: PinCheckResult }
  | { state: "error"; message: string };

type Props = {
  value: Pin | null;
  /** New pin, plus what reverse geocoding found there (null if it failed). */
  onChange: (pin: Pin, found: PinFound | null) => void;
};

/**
 * Drop or drag a pin for the delivery or farm location (U1). Clicking the map
 * moves the pin; the pin can also be dragged. Each new pin is checked for a
 * road near it (pin quality, control 5): a second marker shows where the rider
 * stops, and a pin with no road is reported before the form is saved.
 */
export default function MapPinPicker({ value, onChange }: Props) {
  const { t } = useLanguage();
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const roadMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  // Only the newest pin's answers are used; a quick second drag wins.
  const seqRef = useRef(0);
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "locating" | "unavailable">("idle");
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const token = process.env.NEXT_PUBLIC_MAPBOX_API_KEY;

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const showRoad = useCallback((result: PinCheckResult | null) => {
    const map = mapRef.current;
    const marker = roadMarkerRef.current;
    if (!map || !marker) return;
    const far = (result?.road_distance_m ?? 0) >= ROAD_MARKER_MIN_M;
    if (result && result.road_lat != null && result.road_lng != null && far) {
      marker.setLngLat([result.road_lng, result.road_lat]).addTo(map);
    } else {
      marker.remove();
    }
  }, []);

  const runCheck = useCallback(
    async (pin: Pin, seq: number) => {
      setCheck({ state: "checking" });
      showRoad(null);
      try {
        const result = await checkPin(pin);
        if (seq !== seqRef.current) return;
        setCheck({ state: "ok", result });
        showRoad(result);
      } catch (error) {
        if (seq !== seqRef.current) return;
        const code = getApiErrorStatus(error);
        if (code === 422) setCheck({ state: "error", message: t.mapPin.noRoad });
        else if (code === 400) setCheck({ state: "error", message: getApiErrorMessage(error, t.mapPin.noRoad) });
        // Anything else (offline, rate limit): the save checks again, so stay quiet.
        else setCheck({ state: "idle" });
      }
    },
    [showRoad, t.mapPin.noRoad],
  );

  const place = useCallback(
    async (pin: Pin) => {
      const seq = ++seqRef.current;
      void runCheck(pin, seq);
      let found: PinFound | null = null;
      try {
        const address = await reverseGeocode(pin);
        const location = await resolvePinLocation(address.hints);
        found = { ...address, location };
      } catch {
        found = null;
      }
      if (seq !== seqRef.current) return;
      setPlaceName(found?.placeName ?? null);
      onChangeRef.current(pin, found);
    },
    [runCheck],
  );

  // Create the map once; mapbox-gl is loaded only in the browser.
  useEffect(() => {
    if (!token || !container.current) return;
    let cancelled = false;
    let map: mapboxgl.Map | null = null;

    void import("mapbox-gl").then(({ default: mapbox }) => {
      if (cancelled || !container.current) return;
      mapbox.accessToken = token;
      map = new mapbox.Map({
        container: container.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: value ? [value.lng, value.lat] : DEFAULT_CENTER,
        zoom: value ? 16 : 11,
      });
      map.addControl(new mapbox.NavigationControl({ showCompass: false }), "top-right");
      map.on("error", () => setStatus("unavailable"));
      const marker = new mapbox.Marker({ draggable: true, color: PIN_COLOR });
      const roadMarker = new mapbox.Marker({ color: ROAD_COLOR, scale: 0.7 });
      roadMarker.getElement().setAttribute("aria-label", t.mapPin.roadMarker);
      roadMarker.getElement().title = t.mapPin.roadMarker;
      if (value) marker.setLngLat([value.lng, value.lat]).addTo(map);
      marker.on("dragend", () => {
        const { lng, lat } = marker.getLngLat();
        void place({ lat, lng });
      });
      map.on("click", (e) => {
        marker.setLngLat(e.lngLat).addTo(map!);
        void place({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });
      mapRef.current = map;
      markerRef.current = marker;
      roadMarkerRef.current = roadMarker;
      // A saved pin: show where the rider stops, without changing the form.
      if (value) void runCheck(value, ++seqRef.current);
    });

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      markerRef.current = null;
      roadMarkerRef.current = null;
    };
    // The initial view only; later pins move the marker without rebuilding the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setStatus("idle");
        const pin = { lat: coords.latitude, lng: coords.longitude };
        if (mapRef.current && markerRef.current) {
          markerRef.current.setLngLat([pin.lng, pin.lat]).addTo(mapRef.current);
          mapRef.current.flyTo({ center: [pin.lng, pin.lat], zoom: 16 });
        }
        void place(pin);
      },
      () => setStatus("idle"),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  if (!token) {
    return <p className={styles.note}>{t.mapPin.unavailable}</p>;
  }

  let checkNote: { text: string; tone: "info" | "warn" | "error" } | null = null;
  if (check.state === "checking") checkNote = { text: t.mapPin.checking, tone: "info" };
  else if (check.state === "error") checkNote = { text: check.message, tone: "error" };
  else if (check.state === "ok") {
    const { result } = check;
    if (result.blocked) checkNote = { text: t.mapPin.blocked, tone: "error" };
    else if (result.unreachable_reports > 0) checkNote = { text: t.mapPin.reported, tone: "warn" };
    else if (result.road_distance_m != null && result.road_distance_m >= ROAD_MARKER_MIN_M) {
      checkNote = { text: fmt(t.mapPin.roadNote, { m: Math.round(result.road_distance_m) }), tone: "info" };
    } else if (result.road_distance_m != null) checkNote = { text: t.mapPin.onRoad, tone: "info" };
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.label}>{t.mapPin.label}</span>
        <button type="button" className={styles.locate} onClick={useMyLocation} disabled={status === "locating"}>
          {status === "locating" ? t.mapPin.locating : t.mapPin.useMyLocation}
        </button>
      </div>
      <div ref={container} className={styles.map} role="application" aria-label={t.mapPin.mapLabel} />
      <p className={styles.note}>
        {status === "unavailable"
          ? t.mapPin.unavailable
          : value
            ? placeName ?? t.mapPin.pinned
            : t.mapPin.hint}
      </p>
      {checkNote && (
        <p
          className={`${styles.note} ${checkNote.tone === "error" ? styles.noteError : checkNote.tone === "warn" ? styles.noteWarn : ""}`}
          role={checkNote.tone === "info" ? "status" : "alert"}
        >
          {checkNote.text}
        </p>
      )}
    </div>
  );
}
