"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import mapboxgl from 'mapbox-gl';
import type { TrackingData, Waypoint } from '@/util/api';
import {
  fetchRouteGeoJSON,
  getPositionAlongRoute,
  isClosedStatus,
  statusLabel,
  type LatLng,
  type RouteGeoJSON,
} from '@/util/tracking';
import styles from './RouteMap.module.css';

// Shared by the buyer "Track order" page and the merchant "Routing" page.
// The moving dot is placed from the planned schedule, not GPS, so it is always
// labelled "Estimated position".

export const PICKUP_COLOR = '#3b82f6';
export const HIGHLIGHT_STOP_COLOR = '#f59e0b';
export const OTHER_STOP_COLOR = '#ef4444';
export const CLOSED_STOP_COLOR = '#6b7280';
export const POSITION_COLOR = '#22c55e';

const ROUTE_SOURCE = 'shipment-route';
const ROUTE_LAYER = 'shipment-route-line';
const ESTIMATED_POSITION = 'Estimated position';

type MarkerSpec = { lng: number; lat: number; color: string; text: string; label: string };

const waypointColor = (wp: Waypoint, highlightOrderId: number | null) => {
  if (wp.type === 'pickup') return PICKUP_COLOR;
  if (isClosedStatus(wp.status)) return CLOSED_STOP_COLOR;
  return wp.order_id != null && wp.order_id === highlightOrderId ? HIGHLIGHT_STOP_COLOR : OTHER_STOP_COLOR;
};

const waypointLabel = (wp: Waypoint) =>
  wp.type === 'pickup' ? `Pickup: ${wp.label}` : `Stop ${wp.sequence}: ${wp.label} · ${statusLabel(wp.status)}`;

const toMarkerSpec = (wp: Waypoint, highlightOrderId: number | null): MarkerSpec => ({
  lng: wp.lng,
  lat: wp.lat,
  color: waypointColor(wp, highlightOrderId),
  text: wp.type === 'pickup' ? 'P' : String(wp.sequence),
  label: waypointLabel(wp),
});

function FallbackRouteMap({ markers }: { markers: MarkerSpec[] }) {
  if (markers.length === 0) return null;

  const lngs = markers.map((m) => m.lng);
  const lats = markers.map((m) => m.lat);
  const minLng = Math.min(...lngs);
  const minLat = Math.min(...lats);
  const lngSpan = Math.max(Math.max(...lngs) - minLng, 0.001);
  const latSpan = Math.max(Math.max(...lats) - minLat, 0.001);
  const points = markers.map((m) => ({
    x: 8 + ((m.lng - minLng) / lngSpan) * 84,
    y: 92 - ((m.lat - minLat) / latSpan) * 84,
  }));

  return (
    <div className={styles.fallbackMap} role="img" aria-label="Shipment route diagram">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline
          points={points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={POSITION_COLOR}
          strokeWidth="1.2"
          strokeDasharray="2 1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {markers.map((m, index) => (
        <div
          className={`${styles.stopMarker} ${styles.fallbackMarker}`}
          key={`${m.text}-${index}`}
          style={{ left: `${points[index].x}%`, top: `${points[index].y}%`, backgroundColor: m.color }}
          title={m.label}
        >
          {m.text}
        </div>
      ))}
      <div className={styles.fallbackMapMessage}>
        Map imagery is temporarily unavailable. Showing the shipment route.
      </div>
    </div>
  );
}

export type RouteMapProps = {
  tracking: TrackingData | null;
  /** The stop drawn in the highlight colour (the buyer's stop, or the merchant's next stop). */
  highlightOrderId: number | null;
  /** Legend text for the highlighted stop. */
  highlightLabel: string;
  /** Buyers only ever see their own stop, so their legend leaves this out. */
  showOtherStops?: boolean;
  /** Overlays drawn on top of the map, such as an ETA chip. */
  children?: ReactNode;
};

export default function RouteMap({
  tracking,
  highlightOrderId,
  highlightLabel,
  showOtherStops = true,
  children,
}: RouteMapProps) {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const positionMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [routeResult, setRouteResult] = useState<{ key: string; route: RouteGeoJSON | null } | null>(null);

  const waypoints = useMemo(() => tracking?.waypoints ?? [], [tracking]);

  // Value-keyed so a poll that returns the same route does not redraw anything.
  const markersKey = JSON.stringify(waypoints.map((wp) => toMarkerSpec(wp, highlightOrderId)));
  const markers = useMemo(() => JSON.parse(markersKey) as MarkerSpec[], [markersKey]);
  const routeKey = JSON.stringify(waypoints.map(({ lat, lng }) => ({ lat, lng })));
  const routePoints = useMemo(() => JSON.parse(routeKey) as LatLng[], [routeKey]);
  const route = routeResult?.key === routeKey ? routeResult.route : null;

  const progress = tracking?.progress ?? 0;
  const origin = tracking?.origin ?? null;

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_API_KEY || '';
    const map = new mapboxgl.Map({
      container: node,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [121.013, 14.567],
      zoom: 12,
    });
    map.on('load', () => setStyleReady(true));
    map.on('error', (event) => {
      if (event.error) console.error('[route-map] Mapbox map error:', event.error);
      setMapUnavailable(true);
    });
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    mapRef.current = map;

    // The pane is flex/grid-sized, so keep the canvas in sync with its container.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(node);

    return () => {
      resizeObserver.disconnect();
      positionMarkerRef.current?.remove();
      positionMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
      setStyleReady(false);
    };
  }, []);

  // Road route from Mapbox Directions, fetched once per set of stops.
  useEffect(() => {
    if (routePoints.length < 2 || mapUnavailable) return;
    let cancelled = false;
    const token = process.env.NEXT_PUBLIC_MAPBOX_API_KEY ?? '';
    void fetchRouteGeoJSON(routePoints, token).then((fetched) => {
      if (!cancelled) setRouteResult({ key: routeKey, route: fetched });
    });
    return () => {
      cancelled = true;
    };
  }, [routeKey, routePoints, mapUnavailable]);

  // Draw (or clear) the route line once the style can take layers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    const source = map.getSource(ROUTE_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (route) {
      if (source) {
        source.setData(route);
      } else {
        map.addSource(ROUTE_SOURCE, { type: 'geojson', data: route });
        map.addLayer({
          id: ROUTE_LAYER,
          type: 'line',
          source: ROUTE_SOURCE,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': POSITION_COLOR, 'line-width': 4, 'line-opacity': 0.85 },
        });
      }
    } else if (source) {
      if (map.getLayer(ROUTE_LAYER)) map.removeLayer(ROUTE_LAYER);
      map.removeSource(ROUTE_SOURCE);
    }
  }, [route, styleReady]);

  // Numbered stop markers; redrawn only when a stop, its status or the highlight changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const placed = markers.map((spec) => {
      const el = document.createElement('div');
      el.className = styles.stopMarker;
      el.style.backgroundColor = spec.color;
      el.textContent = spec.text;
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', spec.label);
      return new mapboxgl.Marker({ element: el })
        .setLngLat([spec.lng, spec.lat])
        .setPopup(new mapboxgl.Popup({ offset: 18 }).setText(spec.label))
        .addTo(map);
    });
    return () => placed.forEach((marker) => marker.remove());
  }, [markers]);

  // Frame the stops whenever the set of stops changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || routePoints.length === 0) return;
    const bounds = new mapboxgl.LngLatBounds();
    routePoints.forEach((p) => bounds.extend([p.lng, p.lat]));
    map.fitBounds(bounds, { padding: 80, maxZoom: 14 });
  }, [routePoints]);

  // Estimated position along the planned route (not GPS).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !origin) return;
    const lngLat: [number, number] = route
      ? getPositionAlongRoute(route, progress)
      : [origin.lng, origin.lat];
    if (positionMarkerRef.current) {
      positionMarkerRef.current.setLngLat(lngLat);
      return;
    }
    const el = document.createElement('div');
    el.className = styles.positionMarker;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', ESTIMATED_POSITION);
    positionMarkerRef.current = new mapboxgl.Marker({ element: el })
      .setLngLat(lngLat)
      .setPopup(new mapboxgl.Popup({ offset: 14 }).setText(`${ESTIMATED_POSITION} (from the planned schedule, not GPS)`))
      .addTo(map);
  }, [route, progress, origin]);

  return (
    <div className={styles.root}>
      <div className={styles.mapCanvas} ref={containerRef} />
      {mapUnavailable && <FallbackRouteMap markers={markers} />}
      {children}
      <ul className={styles.legend} aria-label="Map legend">
        <li><span className={styles.legendDot} style={{ backgroundColor: PICKUP_COLOR }} />Pickup</li>
        <li><span className={styles.legendDot} style={{ backgroundColor: HIGHLIGHT_STOP_COLOR }} />{highlightLabel}</li>
        {showOtherStops && (
          <li><span className={styles.legendDot} style={{ backgroundColor: OTHER_STOP_COLOR }} />Other stops</li>
        )}
        <li><span className={styles.legendDot} style={{ backgroundColor: CLOSED_STOP_COLOR }} />Delivered or cancelled</li>
        <li><span className={styles.legendDot} style={{ backgroundColor: POSITION_COLOR }} />{ESTIMATED_POSITION}</li>
      </ul>
    </div>
  );
}
