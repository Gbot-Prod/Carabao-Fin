"use client";

import styles from './page.module.css';

import { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import OrderCard from './components/orderCard';
import { orders } from './data/orders';

function Track() {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const [selectedOrderIndex, setSelectedOrderIndex] = useState(0);

  const selectedOrder = orders[selectedOrderIndex];

  const formattedDeliveryFee = new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(selectedOrder.deliveryFee);

  useEffect(() => {
    if (!mapContainerRef.current) {
      return;
    }

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_API_KEY || '';
    mapRef.current = new mapboxgl.Map({
      container: mapContainerRef.current,
      center: [121.05, 14.53],
      zoom: 11,
      projection: 'globe',
    });

    mapRef.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

    return () => {
      mapRef.current?.remove();
    };
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.trackingContainer}>
        <div className={styles.mapSection}>
          <div className={styles.mapBoxContainer} ref={mapContainerRef} />
          <div className={styles.detailsSection}>
            <h2 className={styles.sectionTitle}>Delivery Details</h2>
            <div className={styles.detailGrid}>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Merchant</span>
                <p className={styles.detailValue}>{selectedOrder.merchant}</p>
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
            </div>
          </div>
        </div>

        <div className={styles.ordersSection}>
          <h1 className={styles.sectionTitle}>Current Orders</h1>
          <ul className={styles.orderList}>
            {orders.map((order, index) => (
              <OrderCard
                key={`${order.merchant}-${index}`}
                order={order}
                isSelected={selectedOrderIndex === index}
                onClick={() => setSelectedOrderIndex(index)}
              />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default Track;