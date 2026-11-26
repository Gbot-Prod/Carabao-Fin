"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRouteMap, type RouteMapHandle } from '@/lib/maps/routeMap';
import { mapKey } from '@/lib/maps/provider';
import type { TrackingData, Waypoint } from '@/util/api';
import {
  fetchRouteGeoJSON,
  getPositionAlongRoute,
  isClosedStatus,
  statusLabel,
  type LatLng,
  type RouteGeoJSON,
  type RouteSource,
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
  /** Where the road line comes from: the buyer's order or the merchant's shipment. */
  routeFor: RouteSource['kind'];
  /** Overlays drawn on top of the map, such as an ETA chip. */
  children?: ReactNode;
};

export default function RouteMap({
  tracking,
  highlightOrderId,
  highlightLabel,
  showOtherStops = true,
  routeFor,
  children,
}: RouteMapProps) {
  // The map (Google Maps or Mapbox: lib/maps/provider.ts), once its library has loaded.
  const [map, setMap] = useState<RouteMapHandle | null>(null);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [routeResult, setRouteResult] = useState<{ key: string; route: RouteGeoJSON | null } | null>(null);

  const waypoints = useMemo(() => tracking?.waypoints ?? [], [tracking]);
  const hasStops = waypoints.length > 0;

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
    if (!mapKey()) {
      setMapUnavailable(true);
      return;
    }
    let cancelled = false;
    let created: RouteMapHandle | null = null;
    createRouteMap({
      container: node,
      center: { lat: 14.567, lng: 121.013 },
      zoom: 12,
      lineColor: POSITION_COLOR,
      stopClass: styles.stopMarker,
      positionClass: styles.positionMarker,
      onError: () => setMapUnavailable(true),
    }).then(
      (handle) => {
        if (cancelled) {
          handle.destroy();
          return;
        }
        created = handle;
        setMap(handle);
      },
      (error) => {
        console.error('[route-map] map did not load:', error);
        if (!cancelled) setMapUnavailable(true);
      },
    );

    return () => {
      cancelled = true;
      created?.destroy();
      setMap(null);
    };
  }, []);

  // Road route (asked by the API, Google or Mapbox), fetched once per set of stops.
  const sourceId = routeFor === 'order' ? tracking?.order_id : tracking?.shipment_id;
  useEffect(() => {
    if (routePoints.length < 2 || mapUnavailable || !sourceId) return;
    let cancelled = false;
    void fetchRouteGeoJSON({ kind: routeFor, id: sourceId }).then((fetched) => {
      if (!cancelled) setRouteResult({ key: routeKey, route: fetched });
    });
    return () => {
      cancelled = true;
    };
  }, [routeKey, routePoints, mapUnavailable, routeFor, sourceId]);

  // Draw (or clear) the route line.
  useEffect(() => {
    map?.setRoute(route);
  }, [map, route]);

  // Numbered stop markers; redrawn only when a stop, its status or the highlight changes.
  useEffect(() => {
    if (!map) return;
    map.setStops(markers);
    return () => map.setStops([]);
  }, [map, markers]);

  // Frame the stops whenever the set of stops changes.
  useEffect(() => {
    map?.fitTo(routePoints);
  }, [map, routePoints]);

  // Estimated position along the planned route (not GPS).
  useEffect(() => {
    if (!map || !origin) return;
    const lngLat: [number, number] = route
      ? getPositionAlongRoute(route, progress)
      : [origin.lng, origin.lat];
    map.setPosition(lngLat, ESTIMATED_POSITION, `${ESTIMATED_POSITION} (from the planned schedule, not GPS)`);
  }, [map, route, progress, origin]);

  return (
    <div className={styles.root}>
      {/* Each map is a billed map load (Google or Mapbox): build one only when there are stops to show. */}
      {hasStops ? (
        <div className={styles.mapCanvas} ref={containerRef} />
      ) : (
        <div className={`${styles.mapCanvas} ${styles.mapPlaceholder}`} aria-hidden="true" />
      )}
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
