"use client";

import styles from './page.module.css';
import Header from '../../components/header/header';

import { useRef, useEffect, useState } from 'react'
import mapboxgl from 'mapbox-gl'

function Track() {

  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_API_KEY || '';
    mapRef.current = new mapboxgl.Map({
      container: mapContainerRef.current as HTMLElement,
      center: [-51.5995, 31.9842],
      zoom: 11
    });

    return () => {
      mapRef.current?.remove();
    };
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.trackingContainer}>
        <h1>Track Your Order</h1>
        <div className={styles.mapSection}>
          <div className={styles.mapBoxContainer} ref={mapContainerRef}></div>
        </div>
        <div className={styles.detailsSection}>
          <h1></h1>
        </div>
      </div>
      <div className={styles.ordersContainer}>
        <ul className={styles.orderList}>
          <li>Order 1</li>
        </ul>
      </div>
    </div>
  );
}

export default Track;