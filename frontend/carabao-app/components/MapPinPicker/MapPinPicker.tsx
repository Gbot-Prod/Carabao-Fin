"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type mapboxgl from "mapbox-gl";
import { forwardGeocode, reverseGeocode, type Pin } from "@/util/geocode";
import { resolvePinLocation } from "@/util/pinLocation";
import { addressComplete, addressQuery, cityFits, cityQuery, pinAreaMismatch, type LocationValue, type TypedAddress } from "@/lib/pin-area";
import { checkPin, type PinCheckResult } from "@/util/api";
import getApiErrorMessage, { getApiErrorStatus } from "@/util/errorHelper";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { fmt } from "@/lib/i18n/format";
import FieldError, { invalidClass } from "@/components/FieldError/FieldError";
import styles from "./MapPinPicker.module.css";

// Metro Manila, the default view before anything is pinned.
const DEFAULT_CENTER: [number, number] = [120.9842, 14.5995];
// The road marker is shown only when the road point is this far from the pin.
const ROAD_MARKER_MIN_M = 5;
// Wait for typing to settle before placing the pin from the address.
const ADDRESS_DEBOUNCE_MS = 700;
const PIN_COLOR = "#277a4d";
const ROAD_COLOR = "#173d25";

const samePin = (a: Pin | null, b: Pin | null) =>
  !!a && !!b && Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lng - b.lng) < 1e-7;

type Check =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; result: PinCheckResult }
  | { state: "error"; message: string };

/** What reverse geocoding found at the current pin. */
type Area = { pin: Pin; placeName: string | null; location: LocationValue | null };

type Props = {
  value: Pin | null;
  /** `confirmed`: the person placed it (click, drag, their location), not the address. */
  onChange: (pin: Pin, confirmed: boolean) => void;
  /**
   * Whether the person placed or confirmed the current pin. A pin placed from
   * the address is only a suggestion: forms save it only once confirmed.
   */
  confirmed?: boolean;
  /** Shown under the map, e.g. when saving with the suggested pin not confirmed. */
  error?: string | null;
  /**
   * The typed address. The map stays locked until it is complete; then it
   * places the first pin, and the pin follows it until the person moves the
   * pin. The pin never changes these fields; a pin in another city is flagged.
   */
  address: TypedAddress;
};

/** The "place an accurate pin" notice above the map: riders go to the pin, not the text. */
function PinNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className={styles.notice} role="note">
      <svg className={styles.noticeIcon} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Z" fill="currentColor" />
        <rect x="11" y="5.5" width="2" height="5" rx="1" fill="#fff" />
        <circle cx="12" cy="12.75" r="1.15" fill="#fff" />
      </svg>
      <div>
        <p className={styles.noticeTitle}>{title}</p>
        <p className={styles.noticeBody}>{body}</p>
      </div>
    </div>
  );
}

/**
 * Drop or drag a pin for the delivery or farm location (U1). The address
 * typed above places the pin; clicking the map or dragging fine-tunes it.
 * Each new pin is checked for a road near it (pin quality, control 5): a
 * second marker shows where the rider stops, and a pin with no road is
 * reported before the form is saved.
 */
export default function MapPinPicker({ value, onChange, confirmed, address, error }: Props) {
  const { t } = useLanguage();
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const roadMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  // The pin last placed from the address; while the value is still this pin,
  // address edits move it. Once the person moves it, it stays put.
  const autoPinRef = useRef<{ pin: Pin; zoom: number } | null>(null);
  const [autoPin, setAutoPin] = useState<Pin | null>(null);
  // Only the newest pin's answers are used; a quick second drag wins.
  const seqRef = useRef(0);
  const [ready, setReady] = useState(false);
  // Mapbox found neither the address nor the barangay: the person places the pin.
  const [notFound, setNotFound] = useState(false);
  const [area, setArea] = useState<Area | null>(null);
  const [status, setStatus] = useState<"idle" | "locating" | "unavailable">("idle");
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const token = process.env.NEXT_PUBLIC_MAPBOX_API_KEY;
  const unlocked = addressComplete(address);

  useEffect(() => {
    onChangeRef.current = onChange;
    valueRef.current = value;
  }, [onChange, value]);

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

  const lookUpArea = useCallback(async (pin: Pin, seq: number) => {
    let found: Area = { pin, placeName: null, location: null };
    try {
      const at = await reverseGeocode(pin);
      found = { pin, placeName: at.placeName, location: await resolvePinLocation(at.hints) };
    } catch {
      // No area check without geocoding; the pin itself still counts.
    }
    if (seq === seqRef.current) setArea(found);
  }, []);

  /** The person placed the pin (click, drag, or their location). */
  const place = useCallback((pin: Pin) => {
    onChangeRef.current(pin, true);
  }, []);

  // Create the map once the address is complete; mapbox-gl is loaded only in the browser.
  useEffect(() => {
    if (!token || !unlocked || !container.current) return;
    let cancelled = false;
    let map: mapboxgl.Map | null = null;

    void import("mapbox-gl").then(({ default: mapbox }) => {
      if (cancelled || !container.current) return;
      mapbox.accessToken = token;
      const start = valueRef.current;
      map = new mapbox.Map({
        container: container.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: start ? [start.lng, start.lat] : DEFAULT_CENTER,
        zoom: start ? 16 : 11,
      });
      map.addControl(new mapbox.NavigationControl({ showCompass: false }), "top-right");
      map.on("error", () => setStatus("unavailable"));
      const marker = new mapbox.Marker({ draggable: true, color: PIN_COLOR });
      const roadMarker = new mapbox.Marker({ color: ROAD_COLOR, scale: 0.7 });
      roadMarker.getElement().setAttribute("aria-label", t.mapPin.roadMarker);
      roadMarker.getElement().title = t.mapPin.roadMarker;
      marker.on("dragend", () => {
        const { lng, lat } = marker.getLngLat();
        place({ lat, lng });
      });
      map.on("click", (e) => {
        marker.setLngLat(e.lngLat).addTo(map!);
        place({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });
      mapRef.current = map;
      markerRef.current = marker;
      roadMarkerRef.current = roadMarker;
      setReady(true);
    });

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      markerRef.current = null;
      roadMarkerRef.current = null;
      setReady(false);
    };
    // The initial view only; later pins move the marker without rebuilding the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, unlocked]);

  // Each new pin, whoever set it (the person, the address, a saved address):
  // show it, check the road, and look up its area.
  const lat = value?.lat;
  const lng = value?.lng;
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!ready || !map || !marker) return;
    const seq = ++seqRef.current;
    if (lat == null || lng == null) {
      marker.remove();
      showRoad(null);
      return;
    }
    const pin = { lat, lng };
    const shown = marker.getLngLat?.();
    const onMap = !!marker.getElement().isConnected;
    if (!onMap || !shown || !samePin(pin, { lat: shown.lat, lng: shown.lng })) {
      marker.setLngLat([lng, lat]).addTo(map);
      const auto = autoPinRef.current;
      const zoom = auto && samePin(auto.pin, pin) ? auto.zoom : Math.max(map.getZoom(), 16);
      map.flyTo({ center: [lng, lat], zoom });
    }
    void runCheck(pin, seq);
    void lookUpArea(pin, seq);
  }, [ready, lat, lng, runCheck, lookUpArea, showRoad]);

  // Place the pin from the typed address while there is no pin, or while the
  // pin is still the one the address placed.
  const query = addressQuery(address);
  const streetlessQuery = addressQuery(address, false);
  const areaQuery = cityQuery(address);
  const typedCity = address.city;
  useEffect(() => {
    if (!ready || !query) return;
    const following = () => {
      const current = valueRef.current;
      return !current || samePin(current, autoPinRef.current?.pin ?? null);
    };
    if (!following()) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        let hit = await forwardGeocode(query);
        // A street that matched in another city, or nothing: try the barangay instead.
        if ((!hit || !cityFits(hit.hints.city, typedCity)) && streetlessQuery && streetlessQuery !== query) {
          hit = await forwardGeocode(streetlessQuery);
        }
        if (cancelled || !following()) return;
        if (hit && cityFits(hit.hints.city, typedCity)) {
          setNotFound(false);
          autoPinRef.current = { pin: hit.pin, zoom: hit.zoom };
          setAutoPin(hit.pin);
          onChangeRef.current(hit.pin, false);
          return;
        }
        // Not found: no suggested pin. Show the city so the person can place it.
        setNotFound(true);
        const area = areaQuery ? await forwardGeocode(areaQuery) : null;
        if (!cancelled && area && mapRef.current) {
          mapRef.current.flyTo({ center: [area.pin.lng, area.pin.lat], zoom: 13 });
        }
      } catch {
        // Geocoding is down: no suggestion; the person places the pin.
        if (!cancelled) setNotFound(true);
      }
    }, ADDRESS_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ready, query, streetlessQuery, areaQuery, typedCity]);

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setStatus("idle");
        place({ lat: coords.latitude, lng: coords.longitude });
      },
      () => setStatus("idle"),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  if (!token) {
    return <p className={styles.note}>{t.mapPin.unavailable}</p>;
  }

  if (!unlocked) {
    return (
      <div className={styles.wrap}>
        <span className={styles.label}>{t.mapPin.label}</span>
        <div className={styles.locked} role="note">{t.mapPin.locked}</div>
      </div>
    );
  }

  const currentArea = value && area && samePin(area.pin, value) ? area : null;
  const mismatch = currentArea
    ? pinAreaMismatch(currentArea.location, { province: address.province, city: address.city })
    : null;
  // Placed from the address in this visit, or a saved pin nobody placed by hand.
  const fromAddress = !!value && (samePin(value, autoPin) || confirmed === false);

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
    <div className={`${styles.wrap}${invalidClass(error)}`}>
      <div className={styles.header}>
        <span className={styles.label}>{t.mapPin.label}</span>
        <button type="button" className={styles.locate} onClick={useMyLocation} disabled={status === "locating"}>
          {status === "locating" ? t.mapPin.locating : t.mapPin.useMyLocation}
        </button>
      </div>
      <PinNotice title={t.mapPin.noticeTitle} body={t.mapPin.noticeBody} />
      <div ref={container} className={styles.map} role="application" aria-label={t.mapPin.mapLabel} />
      <p className={styles.note}>
        {status === "unavailable"
          ? t.mapPin.unavailable
          : !value
            ? notFound
              ? t.mapPin.notFound
              : t.mapPin.hint
            : fromAddress
              ? t.mapPin.fromAddress
              : currentArea?.placeName ?? t.mapPin.pinned}
      </p>
      {value && confirmed === false && (
        <button type="button" className={styles.confirm} onClick={() => onChangeRef.current(value, true)}>
          {t.mapPin.confirmPin}
        </button>
      )}
      <FieldError id="map-pin" message={error} />
      {mismatch && (
        <p className={`${styles.note} ${styles.noteWarn}`} role="alert">
          {fmt(t.mapPin.mismatch, { pin: mismatch.pin, typed: mismatch.typed })}
        </p>
      )}
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
