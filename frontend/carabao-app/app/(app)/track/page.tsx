"use client";

import Link from 'next/link';
import styles from './page.module.css';

import { useRef, useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import mapboxgl from 'mapbox-gl';
import OrderCard from './components/orderCard';
import { fetchCurrentOrders, fetchTracking, type TrackingData, type Waypoint } from '@/util/api';
import { fetchShipmentTracking } from '@/util/api';
import { fetchRouteGeoJSON, getPositionAlongRoute, type RouteGeoJSON } from '@/util/tracking';
import getApiErrorMessage, { getApiErrorStatus } from '@/util/errorHelper';
import PageLoader from '@/components/PageLoader/PageLoader';

type TrackOrder = {
  id: number;
  orderId: number;
  merchant: string;
  merchantId: number | null;
  shipped: boolean;
  dateBought: string;
  timeOfArrival: string;
  deliveryFee: number;
  image: string;
  status: string;
};

// Matches the backend's IN_TRANSIT_STATUSES; only these orders have a route to track.
const IN_TRANSIT_STATUSES = new Set(['shipped', 'out_for_delivery']);

const isInTransit = (order: Awaited<ReturnType<typeof fetchCurrentOrders>>[number]) =>
  IN_TRANSIT_STATUSES.has(order.status?.toLowerCase());

const toTrackOrder = (order: Awaited<ReturnType<typeof fetchCurrentOrders>>[number]): TrackOrder => ({
  id: order.id,
  orderId: order.order_id,
  merchant: order.merchant,
  merchantId: order.merchant_id ?? null,
  // current_order.shipped is never flipped by the backend, so derive it from status.
  shipped: order.shipped || isInTransit(order),
  dateBought: new Date(order.date_bought).toLocaleDateString(),
  timeOfArrival: order.time_of_arrival
    ? new Date(order.time_of_arrival).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'N/A',
  deliveryFee: order.delivery_fee,
  image: order.image ?? '',
  status: order.status,
});

function buildBounds(waypoints: Waypoint[]): mapboxgl.LngLatBounds {
  const bounds = new mapboxgl.LngLatBounds();
  waypoints.forEach(w => bounds.extend([w.lng, w.lat]));
  return bounds;
}

function FallbackRouteMap({
  waypoints,
  activeOrderId,
}: {
  waypoints: Waypoint[];
  activeOrderId: number | null;
}) {
  if (waypoints.length === 0) return null;

  const lngs = waypoints.map((waypoint) => waypoint.lng);
  const lats = waypoints.map((waypoint) => waypoint.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const lngSpan = Math.max(maxLng - minLng, 0.001);
  const latSpan = Math.max(maxLat - minLat, 0.001);
  const project = (waypoint: Waypoint) => ({
    x: 8 + ((waypoint.lng - minLng) / lngSpan) * 84,
    y: 92 - ((waypoint.lat - minLat) / latSpan) * 84,
  });
  const points = waypoints.map(project);

  return (
    <div className={styles.fallbackMap} role="img" aria-label="Shipment route diagram">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline
          points={points.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke="#22c55e"
          strokeWidth="1.2"
          strokeDasharray="2 1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {waypoints.map((waypoint, index) => {
        const point = points[index];
        const isPickup = waypoint.type === "pickup";
        const isActive = waypoint.order_id === activeOrderId;
        return (
          <div
            className={styles.fallbackMarker}
            key={`${waypoint.order_id ?? "pickup"}-${waypoint.sequence}`}
            style={{
              left: `${point.x}%`,
              top: `${point.y}%`,
              backgroundColor: isPickup ? "#3b82f6" : isActive ? "#f59e0b" : "#ef4444",
            }}
            title={waypoint.label}
          />
        );
      })}
      <div className={styles.fallbackMapMessage}>
        Map imagery is temporarily unavailable. Showing the shipment route.
      </div>
    </div>
  );
}

function Track() {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const driverMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const stopMarkersRef = useRef<mapboxgl.Marker[]>([]);
  // routeRef: set only after the route is successfully drawn onto the map.
  // pendingRouteRef: fetched from Directions API but not yet drawn (style may not be ready).
  const routeRef = useRef<RouteGeoJSON | null>(null);
  const pendingRouteRef = useRef<RouteGeoJSON | null>(null);
  const stopMarkersPlacedRef = useRef(false);
  const activeStopOrderIdRef = useRef<number | null>(null);
  const routeAttemptedRef = useRef(false);
  const mapUnavailableRef = useRef(false);
  const [tracking, setTracking] = useState<TrackingData | null>(null);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [currentOrders, setCurrentOrders] = useState<TrackOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [selectedOrderIndex, setSelectedOrderIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const selectedOrder = currentOrders[selectedOrderIndex];

  useEffect(() => {
    // Capture the client clock once so the ETA display remains render-pure.
    setCurrentTime(Date.now());
  }, []);

  useEffect(() => {
    const loadCurrentOrders = async () => {
      try {
        const response = (await fetchCurrentOrders()).filter(isInTransit);
        if (response.length > 0) {
          setCurrentOrders(response.map(toTrackOrder));
          setSelectedOrderIndex(0);
        }
      } catch {
        // orders stay empty if the backend is unavailable
      } finally {
        setOrdersLoading(false);
      }
    };

    void loadCurrentOrders();
  }, []);

  useEffect(() => {
    if (selectedOrderIndex >= currentOrders.length) {
      // Keep the selection valid when the loaded order list shrinks.
      setSelectedOrderIndex(0);
    }
  }, [currentOrders.length, selectedOrderIndex]);

  const drawRouteLayer = useCallback((map: mapboxgl.Map, route: RouteGeoJSON) => {
    if (map.getSource('driver-route')) {
      (map.getSource('driver-route') as mapboxgl.GeoJSONSource).setData(route);
    } else {
      map.addSource('driver-route', { type: 'geojson', data: route });
      map.addLayer({
        id: 'driver-route-line',
        type: 'line',
        source: 'driver-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#22c55e', 'line-width': 4, 'line-opacity': 0.85 },
      });
    }
  }, []);

  const placeStopMarkers = useCallback((map: mapboxgl.Map, waypoints: Waypoint[], activeOrderId: number | null) => {
    if (!map.getContainer()) return;

    stopMarkersRef.current.forEach(m => m.remove());
    stopMarkersRef.current = [];

    waypoints.forEach(wp => {
      const color = wp.type === 'pickup'
        ? '#3b82f6'
        : wp.order_id && wp.order_id === activeOrderId
          ? '#f59e0b'
          : '#ef4444';
      const marker = new mapboxgl.Marker({ color })
        .setLngLat([wp.lng, wp.lat])
        .setPopup(new mapboxgl.Popup({ offset: 25 }).setText(wp.label))
        .addTo(map);
      stopMarkersRef.current.push(marker);
    });
  }, []);

  const updateDriverMarker = useCallback((map: mapboxgl.Map, lngLat: [number, number]) => {
    if (!driverMarkerRef.current) {
      const el = document.createElement('div');
      el.style.cssText = 'background:#22c55e;width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4)';
      driverMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat(lngLat)
        .setPopup(new mapboxgl.Popup({ offset: 20 }).setText('Driver'))
        .addTo(map);
    } else {
      driverMarkerRef.current.setLngLat(lngLat);
    }
  }, []);

  const updateTracking = useCallback(async (data: TrackingData, map: mapboxgl.Map) => {
    const activeOrderId = data.stops[data.active_stop_index]?.order_id ?? null;

    // Place stop markers once per order — markers are DOM elements and work
    // regardless of whether the map style is ready.
    if (data.waypoints.length > 0 && activeStopOrderIdRef.current !== activeOrderId) {
      placeStopMarkers(map, data.waypoints, activeOrderId);
      activeStopOrderIdRef.current = activeOrderId;
    }

    if (!stopMarkersPlacedRef.current && data.waypoints.length > 0) {
      stopMarkersPlacedRef.current = true;
      map.fitBounds(buildBounds(data.waypoints), { padding: 80, maxZoom: 14 });
    }

    // Fetch the route from Mapbox Directions once per order selection.
    // Store it in pendingRouteRef so we never redundantly hit the API.
    if (!mapUnavailableRef.current && !routeAttemptedRef.current && !routeRef.current && !pendingRouteRef.current) {
      routeAttemptedRef.current = true;
      const token = process.env.NEXT_PUBLIC_MAPBOX_API_KEY ?? '';
      const route = await fetchRouteGeoJSON(data.waypoints, token);
      if (route) {
        pendingRouteRef.current = route;
      }
    }

    // Draw the route layer as soon as the map style is ready.
    // addSource/addLayer require isStyleLoaded() — retry on every poll until it's true.
    if (pendingRouteRef.current && !routeRef.current) {
      if (map.isStyleLoaded()) {
        try {
          drawRouteLayer(map, pendingRouteRef.current);
          routeRef.current = pendingRouteRef.current;
          pendingRouteRef.current = null;
          routeAttemptedRef.current = false;
          mapUnavailableRef.current = false;
        } catch (err) {
          console.error('[tracking] drawRouteLayer failed:', err);
        }
      }
    }

    const driverLngLat: [number, number] = routeRef.current
      ? getPositionAlongRoute(routeRef.current, data.progress)
      : [data.origin.lng, data.origin.lat];

    updateDriverMarker(map, driverLngLat);
  }, [drawRouteLayer, placeStopMarkers, updateDriverMarker]);

  const searchParams = useSearchParams();

  const cleanupMap = useCallback((timerId: ReturnType<typeof setTimeout>) => {
    clearTimeout(timerId);
    const map = mapRef.current;
    if (map?.getLayer('driver-route-line')) map.removeLayer('driver-route-line');
    if (map?.getSource('driver-route')) map.removeSource('driver-route');
    routeRef.current = null;
    pendingRouteRef.current = null;
    stopMarkersPlacedRef.current = false;
    activeStopOrderIdRef.current = null;
    driverMarkerRef.current?.remove();
    driverMarkerRef.current = null;
    stopMarkersRef.current.forEach(m => m.remove());
    stopMarkersRef.current = [];
    setTracking(null);
    setTrackingError(null);
    setMapUnavailable(false);
  }, []);

  useEffect(() => {
    const shipmentIdParam = searchParams.get('shipment_id');
    const shipmentId = shipmentIdParam ? Number(shipmentIdParam) : null;
    const orderId = selectedOrder?.orderId;

    // If a shipment_id is present in the URL, poll shipment endpoint instead
    if (shipmentId) {
      let attempts = 0;
      let timerId: ReturnType<typeof setTimeout>;
      let inFlight = false;
      let active = true;
      let hasTracking = false;
      const maxAttempts = 5;

      const pollShipment = async () => {
        if (!active || inFlight) return;
        inFlight = true;
        try {
          setTrackingError(null);
          const data = await fetchShipmentTracking(shipmentId);
          if (!active) return;
          setTracking(data);
          hasTracking = true;
          const map = mapRef.current;
          if (map) await updateTracking(data, map);
        } catch (err) {
          if (getApiErrorStatus(err) === 412) {
            setTrackingError('Shipment route is not ready yet. Tracking will appear after dispatch.');
          } else {
            setTrackingError(getApiErrorMessage(err, 'Tracking data is not ready yet.'));
            console.error('[tracking] fetch failed:', err);
          }
        } finally {
          inFlight = false;
          attempts += 1;
          if (active && attempts < maxAttempts) {
            timerId = setTimeout(() => void pollShipment(), 3000);
          } else if (active && !hasTracking) {
            setTrackingError('Tracking is not available yet. Try again after the merchant dispatches this order.');
          }
        }
      };

      void pollShipment();
      return () => {
        active = false;
        cleanupMap(timerId);
      };
    }

    if (!orderId) return;

    if (!selectedOrder?.shipped) {
      setTrackingError('Tracking will appear after the merchant dispatches this order.');
      return;
    }

    let attempts = 0;
    let timerId: ReturnType<typeof setTimeout>;
    let inFlight = false;
    let active = true;
    let hasTracking = false;
    const maxAttempts = 5;

    const poll = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        setTrackingError(null);
        const data = await fetchTracking(orderId);
        if (!active) return;
        setTracking(data);
        hasTracking = true;
        // Read mapRef AFTER the await — if the map was removed while fetching
        // (order changed, component unmounted), mapRef.current will be null here.
        const map = mapRef.current;
        if (map) await updateTracking(data, map);
      } catch (err) {
        if (getApiErrorStatus(err) === 412) {
          setTrackingError('Shipment route is not ready yet. Tracking will appear after dispatch.');
        } else {
          setTrackingError(getApiErrorMessage(err, 'Tracking data is not ready yet.'));
          console.error('[tracking] fetch failed:', err);
        }
      } finally {
        inFlight = false;
        attempts += 1;
        if (active && attempts < maxAttempts) {
          timerId = setTimeout(() => void poll(), 3000);
        } else if (active && !hasTracking) {
          setTrackingError('Tracking is not available yet. Try again after the merchant dispatches this order.');
        }
      }
    };

    void poll();
    return () => {
      active = false;
      cleanupMap(timerId);
    };
  }, [selectedOrder?.orderId, selectedOrder?.shipped, updateTracking, searchParams, cleanupMap]);

  const formattedDeliveryFee = new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(selectedOrder?.deliveryFee ?? 0);

  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const mapContainerRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      return;
    }
    if (mapRef.current) return;

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_API_KEY || '';
    const map = new mapboxgl.Map({
      container: node,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [121.013, 14.567],
      zoom: 12,
    });
    map.on('error', (event) => {
      if (event.error) {
        console.error('[tracking] Mapbox map error:', event.error);
      }
      mapUnavailableRef.current = true;
      setMapUnavailable(true);
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    // The map pane is flex-sized, so keep the canvas in sync with its container.
    resizeObserverRef.current = new ResizeObserver(() => mapRef.current?.resize());
    resizeObserverRef.current.observe(node);
  }, []);

  const activeStopNumber = tracking
    ? Math.min(tracking.active_stop_index + 1, tracking.stops.length)
    : 0;
  const estimatedArrival = tracking && currentTime
    ? new Date(currentTime + tracking.eta_minutes * 60_000).toLocaleString('en-PH', { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })
    : selectedOrder?.shipped
      ? selectedOrder.timeOfArrival
      : 'Pending shipment';

  const ordersPane = (
    <aside className={styles.ordersSection}>
      <div className={styles.paneHeader}>
        <h1 className={styles.pageTitle}>Track orders</h1>
        <span className={styles.countBadge}>{currentOrders.length}</span>
      </div>
      <ul className={styles.orderList}>
        {currentOrders.map((order, index) => (
          <OrderCard
            key={`${order.orderId}-${index}`}
            order={order}
            isSelected={selectedOrderIndex === index}
            onClick={() => setSelectedOrderIndex(index)}
          />
        ))}
      </ul>
    </aside>
  );

  return (
    <Suspense fallback={<PageLoader label="Loading your deliveries…" />}>
      {ordersLoading ? (
        <PageLoader label="Loading your deliveries…" />
      ) : !selectedOrder ? (
        <div className={styles.emptyState}>
          <h1 className={styles.pageTitle}>Track orders</h1>
          <p className={styles.emptyText}>No orders are out for delivery right now. Once a merchant ships your order, you can follow it here.</p>
          <Link href="/orders" className={styles.emptyAction}>View my orders</Link>
        </div>
      ) : (
        <div className={styles.trackingContainer}>
          {ordersPane}

          <section className={styles.mapSection}>
            <div className={styles.mapBoxContainer} ref={mapContainerRef} />
            {mapUnavailable && tracking && (
              <FallbackRouteMap
                waypoints={tracking.waypoints}
                activeOrderId={selectedOrder?.orderId ?? null}
              />
            )}

            {tracking && (
              <div className={styles.mapEtaChip}>
                <span className={styles.mapEtaLabel}>Arriving in</span>
                <strong className={styles.mapEtaValue}>{tracking.eta_minutes} min</strong>
              </div>
            )}

            <ul className={styles.mapLegend} aria-label="Map legend">
              <li><span className={styles.legendDot} style={{ backgroundColor: '#3b82f6' }} />Pickup</li>
              <li><span className={styles.legendDot} style={{ backgroundColor: '#f59e0b' }} />Active stop</li>
              <li><span className={styles.legendDot} style={{ backgroundColor: '#ef4444' }} />Other stops</li>
              <li><span className={styles.legendDot} style={{ backgroundColor: '#22c55e' }} />Driver</li>
            </ul>
          </section>

          <aside className={styles.detailsSection}>
            <h2 className={styles.sectionTitle}>Delivery details</h2>
            <div className={styles.detailGrid}>
              <div className={`${styles.detailItem} ${styles.detailItemWide}`}>
                <span className={styles.detailLabel}>Merchant</span>
                <p className={styles.detailValue}>
                  {selectedOrder.merchantId ? (
                    <Link className={styles.detailLink} href={`/merchant/${selectedOrder.merchantId}`}>{selectedOrder.merchant}</Link>
                  ) : (
                    selectedOrder.merchant
                  )}
                </p>
              </div>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Status</span>
                <p className={styles.detailValue}>{selectedOrder.shipped ? 'Shipped' : 'Not shipped yet'}</p>
              </div>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Date bought</span>
                <p className={styles.detailValue}>{selectedOrder.dateBought}</p>
              </div>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Est. arrival</span>
                <p className={styles.detailValue}>{estimatedArrival}</p>
              </div>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Delivery fee</span>
                <p className={styles.detailValue}>{formattedDeliveryFee}</p>
              </div>
            </div>

            {tracking && (
              <div className={styles.shipmentPanel}>
                <div className={styles.shipmentPanelHeader}>
                  <div>
                    <span className={styles.detailLabel}>Shipment route</span>
                    <h3 className={styles.shipmentTitle}>{tracking.merchant_name}</h3>
                  </div>
                  <span className={styles.shipmentStatus}>{tracking.status.replaceAll('_', ' ')}</span>
                </div>

                <div className={styles.shipmentSummaryRow}>
                  <div>
                    <span className={styles.shipmentSummaryLabel}>Shipment</span>
                    <strong>#{tracking.shipment_id}</strong>
                  </div>
                  <div>
                    <span className={styles.shipmentSummaryLabel}>Stop</span>
                    <strong>{activeStopNumber}/{tracking.stops.length || 1}</strong>
                  </div>
                  <div>
                    <span className={styles.shipmentSummaryLabel}>Live ETA</span>
                    <strong>{tracking.eta_minutes} min</strong>
                  </div>
                </div>

                <ol className={styles.shipmentStopList}>
                  {tracking.stops.map((stop, index) => (
                    <li key={`${stop.order_id}-${stop.sequence}`} className={`${styles.shipmentStopItem} ${index === tracking.active_stop_index ? styles.shipmentStopActive : ''}`}>
                      <div className={styles.shipmentStopHeader}>
                        <span className={styles.shipmentStopBadge}>Stop {stop.sequence}</span>
                        <span className={styles.shipmentStopStatus}>{index === tracking.active_stop_index ? 'Active' : stop.status.replaceAll('_', ' ')}</span>
                      </div>
                      <p className={styles.shipmentStopName}>{stop.buyer_name ?? stop.label}</p>
                      <p className={styles.shipmentStopAddress}>{stop.delivery_address ?? 'Delivery address unavailable'}</p>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {trackingError && !tracking && (
              <p className={styles.shipmentError}>{trackingError}</p>
            )}
          </aside>
        </div>
      )}
    </Suspense>
  );
}

export default Track;
