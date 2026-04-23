"use client";

import Link from 'next/link';
import styles from './page.module.css';

import { useRef, useEffect, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import OrderCard from './components/orderCard';
import { orders as fallbackOrders, type Order } from './data/orders';
import { fetchCurrentOrders, fetchDummyTracking, type TrackingData } from '@/util/api';
import { fetchRouteGeoJSON, getPositionAlongRoute, type RouteGeoJSON } from '@/util/tracking';

type TrackOrder = Order & {
  id: number;
  orderId: number;
  status: string;
  merchantId: number | null;
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
  image: order.image || '/images/farms/dole.jpg',
  status: order.status,
});

function Track() {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const driverMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const destinationMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const originMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const routeRef = useRef<RouteGeoJSON | null>(null);
  const [tracking, setTracking] = useState<TrackingData | null>(null);
  const [currentOrders, setCurrentOrders] = useState<TrackOrder[]>(
    fallbackOrders.map((order, index) => ({
      id: index + 1,
      orderId: index + 1,
      merchantId: null,
      ...order,
      status: order.shipped ? 'shipped' : 'pending',
    })),
  );
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
        // Keep the fallback orders when the backend is unavailable.
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

  const placeMarkers = useCallback((
    map: mapboxgl.Map,
    driverLngLat: [number, number],
    origin: TrackingData['origin'],
    destination: TrackingData['destination'],
  ) => {
    if (!driverMarkerRef.current) {
      const el = document.createElement('div');
      el.style.cssText = 'background:#22c55e;width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4)';
      driverMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat(driverLngLat)
        .setPopup(new mapboxgl.Popup({ offset: 20 }).setText('Driver'))
        .addTo(map);
    } else {
      driverMarkerRef.current.setLngLat(driverLngLat);
    }

    if (!originMarkerRef.current) {
      originMarkerRef.current = new mapboxgl.Marker({ color: '#3b82f6' })
        .setLngLat([origin.lng, origin.lat])
        .setPopup(new mapboxgl.Popup({ offset: 25 }).setText('Farm (Origin)'))
        .addTo(map);
    }

    if (!destinationMarkerRef.current) {
      destinationMarkerRef.current = new mapboxgl.Marker({ color: '#ef4444' })
        .setLngLat([destination.lng, destination.lat])
        .setPopup(new mapboxgl.Popup({ offset: 25 }).setText('Your Location'))
        .addTo(map);
    }
  }, []);

  const updateTracking = useCallback(async (data: TrackingData, map: mapboxgl.Map) => {
    // Fetch road route once per order selection
    if (!routeRef.current) {
      const token = process.env.NEXT_PUBLIC_MAPBOX_API_KEY ?? '';
      const route = await fetchRouteGeoJSON(data.origin, data.destination, token);
      if (route) {
        routeRef.current = route;
        if (map.loaded()) {
          drawRouteLayer(map, route);
        } else {
          map.once('load', () => drawRouteLayer(map, route));
        }
      }
    }

    // Compute driver position — road-snapped if route is available, raw otherwise
    const driverLngLat: [number, number] = routeRef.current
      ? getPositionAlongRoute(routeRef.current, data.progress)
      : [data.current_position.lng, data.current_position.lat];

    if (map.loaded()) {
      placeMarkers(map, driverLngLat, data.origin, data.destination);
    } else {
      map.once('load', () => placeMarkers(map, driverLngLat, data.origin, data.destination));
    }
  }, [drawRouteLayer, placeMarkers]);

  useEffect(() => {
    const orderId = selectedOrder?.orderId;
    if (!orderId) return;

    const poll = async () => {
      const map = mapRef.current;
      try {
        const data = await fetchDummyTracking(orderId);
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
      originMarkerRef.current?.remove();
      originMarkerRef.current = null;
      destinationMarkerRef.current?.remove();
      destinationMarkerRef.current = null;
      setTracking(null);
    };
  }, [selectedOrder?.orderId, updateTracking]);

  const formattedDeliveryFee = new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(selectedOrder?.deliveryFee ?? 0);

  useEffect(() => {
    if (!mapContainerRef.current) {
      return;
    }

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_API_KEY || '';
    mapRef.current = new mapboxgl.Map({
      container: mapContainerRef.current,
      center: [121.013, 14.567],  // midpoint between Sampaloc and Taguig
      zoom: 12,
      projection: 'globe',
    });

    mapRef.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

    return () => {
      mapRef.current?.remove();
    };
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