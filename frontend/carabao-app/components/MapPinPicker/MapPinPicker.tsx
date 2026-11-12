"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import type mapboxgl from "mapbox-gl";
import { reverseGeocode, type Pin, type PinAddress } from "@/util/reverseGeocode";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import styles from "./MapPinPicker.module.css";

// Metro Manila, the default view before anything is pinned.
const DEFAULT_CENTER: [number, number] = [120.9842, 14.5995];

type Props = {
  value: Pin | null;
  /** New pin, plus what reverse geocoding found there (null if it failed). */
  onChange: (pin: Pin, address: PinAddress | null) => void;
};

/**
 * Drop or drag a pin for the delivery or farm location (U1). Clicking the map
 * moves the pin; the pin can also be dragged. Routing uses this point instead of
 * geocoding the typed address.
 */
export default function MapPinPicker({ value, onChange }: Props) {
  const { t } = useLanguage();
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "locating" | "unavailable">("idle");
  const token = process.env.NEXT_PUBLIC_MAPBOX_API_KEY;

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Create the map once; mapbox-gl is loaded only in the browser.
  useEffect(() => {
    if (!token || !container.current) return;
    let cancelled = false;
    let map: mapboxgl.Map | null = null;

    const place = async (pin: Pin) => {
      let address: PinAddress | null = null;
      try {
        address = await reverseGeocode(pin);
      } catch {
        address = null;
      }
      if (cancelled) return;
      setPlaceName(address?.placeName ?? null);
      onChangeRef.current(pin, address);
    };

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
      const marker = new mapbox.Marker({ draggable: true, color: "#31925d" });
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
    });

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      markerRef.current = null;
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
        void reverseGeocode(pin)
          .catch(() => null)
          .then((address) => {
            setPlaceName(address?.placeName ?? null);
            onChangeRef.current(pin, address);
          });
      },
      () => setStatus("idle"),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  if (!token) {
    return <p className={styles.note}>{t.mapPin.unavailable}</p>;
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
    </div>
  );
}
