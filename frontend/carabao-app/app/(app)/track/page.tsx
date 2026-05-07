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
  const routeRef = useRef<RouteGeoJSON | null>(null);
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
    // Clear previous stop markers
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
    // Fetch road route once per order selection, passing all ALNS-ordered waypoints
    if (!routeRef.current) {
      const token = process.env.NEXT_PUBLIC_MAPBOX_API_KEY ?? '';
      const route = await fetchRouteGeoJSON(data.waypoints, token);
      if (route) {
        routeRef.current = route;
        const addRoute = () => drawRouteLayer(map, route);
        if (map.loaded()) addRoute();
        else map.once('load', addRoute);
      }

      const fitMap = () => {
        if (data.waypoints.length > 0) {
          map.fitBounds(buildBounds(data.waypoints), { padding: 80, maxZoom: 14 });
        }
      };
      if (map.loaded()) fitMap();
      else map.once('load', fitMap);

      const addMarkers = () => placeStopMarkers(map, data.waypoints);
      if (map.loaded()) addMarkers();
      else map.once('load', addMarkers);
    }

    const driverLngLat: [number, number] = routeRef.current
      ? getPositionAlongRoute(routeRef.current, data.progress)
      : [data.origin.lng, data.origin.lat];

    const applyDriver = () => updateDriverMarker(map, driverLngLat);
    if (map.loaded()) applyDriver();
    else map.once('load', applyDriver);
  }, [drawRouteLayer, placeStopMarkers, updateDriverMarker]);

  useEffect(() => {
    const orderId = selectedOrder?.orderId;
    if (!orderId) return;

    const poll = async () => {
      const map = mapRef.current;
      try {
        const data = await fetchTracking(orderId);
        setTracking(data);
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
      center: [121.013, 14.567],
      zoom: 12,
      projection: 'globe',
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
