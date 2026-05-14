"use client";

import Link from 'next/link';
import styles from './page.module.css';

import { useRef, useEffect, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import OrderCard from './components/orderCard';
import { fetchCurrentOrders, fetchTracking, type TrackingData, type Waypoint } from '@/util/api';
import { fetchRouteGeoJSON, getPositionAlongRoute, type RouteGeoJSON } from '@/util/tracking';

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

const toTrackOrder = (order: Awaited<ReturnType<typeof fetchCurrentOrders>>[number]): TrackOrder => ({
  id: order.id,
  orderId: order.order_id,
  merchant: order.merchant,
  merchantId: order.merchant_id ?? null,
  shipped: order.shipped,
  dateBought: new Date(order.date_bought).toLocaleDateString(),
  timeOfArrival: order.time_of_arrival ? new Date(order.time_of_arrival).toLocaleDateString() : 'N/A',
  deliveryFee: order.delivery_fee,
  image: order.image ?? '',
  status: order.status,
});

function buildBounds(waypoints: Waypoint[]): mapboxgl.LngLatBounds {
  const bounds = new mapboxgl.LngLatBounds();
  waypoints.forEach(w => bounds.extend([w.lng, w.lat]));
  return bounds;
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
  const [tracking, setTracking] = useState<TrackingData | null>(null);
  const [currentOrders, setCurrentOrders] = useState<TrackOrder[]>([]);
  const [selectedOrderIndex, setSelectedOrderIndex] = useState(0);

  const selectedOrder = currentOrders[selectedOrderIndex];

  useEffect(() => {
    const loadCurrentOrders = async () => {
      try {
        const response = await fetchCurrentOrders();
        if (response.length > 0) {
          setCurrentOrders(response.map(toTrackOrder));
          setSelectedOrderIndex(0);
        }
      } catch {
        // orders stay empty if the backend is unavailable
      }
    };

    void loadCurrentOrders();
  }, []);

  useEffect(() => {
    if (selectedOrderIndex >= currentOrders.length) {
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

  const placeStopMarkers = useCallback((map: mapboxgl.Map, waypoints: Waypoint[]) => {
    if (!map.getContainer()) return;

    stopMarkersRef.current.forEach(m => m.remove());
    stopMarkersRef.current = [];

    waypoints.forEach(wp => {
      const color = wp.type === 'pickup' ? '#3b82f6' : '#ef4444';
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
    // Place stop markers once per order — markers are DOM elements and work
    // regardless of whether the map style is ready.
    if (!stopMarkersPlacedRef.current && data.waypoints.length > 0) {
      placeStopMarkers(map, data.waypoints);
      stopMarkersPlacedRef.current = true;
      map.fitBounds(buildBounds(data.waypoints), { padding: 80, maxZoom: 14 });
    }

    // Fetch the route from Mapbox Directions once per order selection.
    // Store it in pendingRouteRef so we never redundantly hit the API.
    if (!routeRef.current && !pendingRouteRef.current) {
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

  useEffect(() => {
    const orderId = selectedOrder?.orderId;
    if (!orderId) return;

    const poll = async () => {
      try {
        const data = await fetchTracking(orderId);
        setTracking(data);
        // Read mapRef AFTER the await — if the map was removed while fetching
        // (order changed, component unmounted), mapRef.current will be null here.
        const map = mapRef.current;
        if (map) await updateTracking(data, map);
      } catch (err) {
        console.error('[tracking] fetch failed:', err);
      }
    };

    void poll();
    const intervalId = setInterval(() => void poll(), 3000);

    return () => {
      clearInterval(intervalId);
      const map = mapRef.current;
      if (map?.getLayer('driver-route-line')) map.removeLayer('driver-route-line');
      if (map?.getSource('driver-route')) map.removeSource('driver-route');
      routeRef.current = null;
      pendingRouteRef.current = null;
      stopMarkersPlacedRef.current = false;
      driverMarkerRef.current?.remove();
      driverMarkerRef.current = null;
      stopMarkersRef.current.forEach(m => m.remove());
      stopMarkersRef.current = [];
      setTracking(null);
    };
  }, [selectedOrder?.orderId, updateTracking]);

  const formattedDeliveryFee = new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(selectedOrder?.deliveryFee ?? 0);

  const mapContainerRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      mapRef.current?.remove();
      mapRef.current = null;
      return;
    }
    if (mapRef.current) return;

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_API_KEY || '';
    mapRef.current = new mapboxgl.Map({
      container: node,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [121.013, 14.567],
      zoom: 12,
    });
    mapRef.current.addControl(new mapboxgl.NavigationControl(), 'top-right');
  }, []);

  return (
    <div className={styles.container}>
      {!selectedOrder ? (
        <div className={styles.trackingContainer}>
          <div className={styles.ordersSection}>
            <h1 className={styles.sectionTitle}>Current Orders</h1>
            <p>No active orders yet.</p>
          </div>
        </div>
      ) : (
        <div className={styles.trackingContainer}>
          <div className={styles.mapSection}>
            <div className={styles.mapBoxContainer} ref={mapContainerRef} />
            <div className={styles.detailsSection}>
              <h2 className={styles.sectionTitle}>Delivery Details</h2>
              <div className={styles.detailGrid}>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Merchant</span>
                  <p className={styles.detailValue}>
                    {selectedOrder.merchantId ? (
                      <Link href={`/merchant/${selectedOrder.merchantId}`}>{selectedOrder.merchant}</Link>
                    ) : (
                      selectedOrder.merchant
                    )}
                  </p>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Date Bought</span>
                  <p className={styles.detailValue}>{selectedOrder.dateBought}</p>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Status</span>
                  <p className={styles.detailValue}>{selectedOrder.shipped ? 'Shipped' : 'Not Shipped Yet'}</p>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Estimated Arrival</span>
                  <p className={styles.detailValue}>{selectedOrder.shipped ? selectedOrder.timeOfArrival : 'Pending shipment'}</p>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Delivery Fee</span>
                  <p className={styles.detailValue}>{formattedDeliveryFee}</p>
                </div>
                {tracking && (
                  <div className={styles.detailItem}>
                    <span className={styles.detailLabel}>ETA (live)</span>
                    <p className={styles.detailValue}>{tracking.eta_minutes} min</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={styles.ordersSection}>
            <h1 className={styles.sectionTitle}>Current Orders</h1>
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
          </div>
        </div>
      )}
    </div>
  );
}

export default Track;
