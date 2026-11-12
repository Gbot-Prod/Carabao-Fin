"use client";

import Link from 'next/link';
import styles from './page.module.css';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import OrderCard from './components/orderCard';
import {
  fetchCurrentOrders,
  fetchTracking,
  isInTransit as isInTransitStatus,
} from '@/util/api';
import { isRouteFinished, statusLabel } from '@/util/tracking';
import getApiErrorMessage, { getApiErrorStatus } from '@/util/errorHelper';
import { useVisiblePoll } from '@/hooks/useVisiblePoll';
import { useLanguage } from '@/lib/i18n/LanguageProvider';
import RouteMap from '@/components/RouteMap/RouteMap';
import PageLoader from '@/components/PageLoader/PageLoader';
import SkeletonList, { LoadError } from '@/components/Skeleton/Skeleton';

// Buyer-only "Track order". The backend only ever returns the buyer's own stop.
// Progress and ETA are estimated from the route schedule; there is no live GPS.
const WAITING_MESSAGE = 'Waiting for shipment. Estimated progress will appear after the merchant dispatches this order.';
const NOT_DISPATCHED_MESSAGE = 'Tracking will appear after the merchant dispatches this order.';
const POLL_MS = 30_000;

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

type CurrentOrder = Awaited<ReturnType<typeof fetchCurrentOrders>>[number];

// Only in-transit orders have a route to track.
const isInTransit = (order: CurrentOrder) => isInTransitStatus(order.status);

const toTrackOrder = (order: CurrentOrder): TrackOrder => ({
  id: order.id,
  orderId: order.order_id,
  merchant: order.merchant,
  merchantId: order.merchant_id ?? null,
  shipped: order.shipped,
  dateBought: new Date(order.date_bought).toLocaleDateString(),
  timeOfArrival: order.time_of_arrival
    ? new Date(order.time_of_arrival).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'N/A',
  deliveryFee: order.delivery_fee,
  image: order.image ?? '',
  status: order.status,
});

function Track() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Old merchant links (/track?shipment_id=N) now live on the Routing page.
  const legacyShipmentId = searchParams.get('shipment_id');

  const [currentOrders, setCurrentOrders] = useState<TrackOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState(false);
  const [ordersAttempt, setOrdersAttempt] = useState(0);
  const [selectedOrderIndex, setSelectedOrderIndex] = useState(0);

  useEffect(() => {
    if (legacyShipmentId) {
      router.replace(`/merchantDashboard/routing/${encodeURIComponent(legacyShipmentId)}`);
    }
  }, [legacyShipmentId, router]);

  useEffect(() => {
    if (legacyShipmentId) return;
    const loadCurrentOrders = async () => {
      try {
        const response = (await fetchCurrentOrders()).filter(isInTransit);
        setOrdersError(false);
        setCurrentOrders(response.map(toTrackOrder));
        setSelectedOrderIndex(0);
      } catch {
        // Say so instead of showing "nothing out for delivery".
        setOrdersError(true);
      } finally {
        setOrdersLoading(false);
      }
    };

    void loadCurrentOrders();
  }, [ordersAttempt, legacyShipmentId]);

  // Keep the selection valid if the loaded list is shorter than the index.
  const selectedOrder = currentOrders[selectedOrderIndex] ?? currentOrders[0];
  const orderId = selectedOrder?.orderId ?? null;
  const shipped = selectedOrder?.shipped ?? false;

  const fetcher = useCallback(() => fetchTracking(orderId ?? 0), [orderId]);
  const poll = useVisiblePoll(orderId !== null && shipped ? fetcher : null, isRouteFinished, POLL_MS);

  const waiting = poll.data?.tracking_state === 'waiting_for_shipment';
  const tracking = waiting ? null : poll.data;
  const currentTime = poll.updatedAt;

  let trackingError: string | null = null;
  if (selectedOrder && !shipped) {
    trackingError = NOT_DISPATCHED_MESSAGE;
  } else if (waiting) {
    trackingError = WAITING_MESSAGE;
  } else if (poll.error) {
    trackingError = getApiErrorStatus(poll.error) === 412
      ? 'Shipment route is not ready yet. Tracking will appear after dispatch.'
      : getApiErrorMessage(poll.error, 'Tracking data is not ready yet.');
  }

  if (legacyShipmentId) {
    return <PageLoader label="Opening routing…" />;
  }

  const formattedDeliveryFee = new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(selectedOrder?.deliveryFee ?? 0);

  const activeStopNumber = tracking
    ? Math.min(tracking.active_stop_index + 1, tracking.stops.length)
    : 0;
  // The tracking response carries the order's current status; the order list
  // was only loaded once, so prefer this when we have it.
  const liveOrderStatus = tracking?.stops.find((stop) => stop.order_id === selectedOrder?.orderId)?.status ?? null;
  const etaMinutes = tracking?.eta_minutes ?? null;
  const progressPercent = tracking ? Math.round(tracking.progress * 100) : 0;
  const estimatedArrival = etaMinutes !== null && currentTime
    ? new Date(currentTime + etaMinutes * 60_000).toLocaleString('en-PH', { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })
    : selectedOrder?.shipped
      ? selectedOrder.timeOfArrival
      : 'Pending shipment';

  const title = <h1 className={styles.pageTitle}>{t.trackOrder.title}</h1>;

  if (ordersLoading) {
    return (
      <div className={styles.emptyState}>
        {title}
        <SkeletonList label="Loading your deliveries…" rows={2} />
      </div>
    );
  }

  if (ordersError && !selectedOrder) {
    return (
      <div className={styles.emptyState}>
        {title}
        <LoadError
          message="We couldn't load your deliveries. Check your connection and try again."
          onRetry={() => {
            setOrdersLoading(true);
            setOrdersAttempt((n) => n + 1);
          }}
        />
      </div>
    );
  }

  if (!selectedOrder) {
    return (
      <div className={styles.emptyState}>
        {title}
        <p className={styles.emptyText}>No orders are out for delivery right now. Once a merchant ships your order, you can follow it here.</p>
        <Link href="/orders" className={styles.emptyAction}>View my orders</Link>
      </div>
    );
  }

  return (
    <div className={styles.trackingContainer}>
      <aside className={styles.ordersSection}>
        <div className={styles.paneHeader}>
          {title}
          <span className={styles.countBadge}>{currentOrders.length}</span>
        </div>
        <ul className={styles.orderList}>
          {currentOrders.map((order, index) => (
            <OrderCard
              key={`${order.orderId}-${index}`}
              order={order}
              isSelected={selectedOrder.orderId === order.orderId}
              onClick={() => setSelectedOrderIndex(index)}
            />
          ))}
        </ul>
      </aside>

      <section className={styles.mapSection}>
        <RouteMap
          tracking={tracking}
          highlightOrderId={selectedOrder.orderId}
          highlightLabel={t.trackOrder.yourStop}
          showOtherStops={false}
        >
          {tracking && etaMinutes !== null && (
            <div className={styles.mapEtaChip}>
              <span className={styles.mapEtaLabel}>Estimated arrival in</span>
              <strong className={styles.mapEtaValue}>{etaMinutes} min</strong>
            </div>
          )}
        </RouteMap>
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
            <p className={styles.detailValue}>
              {liveOrderStatus
                ? statusLabel(liveOrderStatus)
                : selectedOrder.shipped ? 'Shipped' : 'Not shipped yet'}
            </p>
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
                <span className={styles.shipmentSummaryLabel}>Estimated progress</span>
                <strong>{etaMinutes !== null ? `${progressPercent}% · ${etaMinutes} min` : 'No estimate yet'}</strong>
              </div>
            </div>

            <ol className={styles.shipmentStopList}>
              {tracking.stops.map((stop, index) => (
                <li key={`${stop.order_id}-${stop.sequence}`} className={`${styles.shipmentStopItem} ${index === tracking.active_stop_index ? styles.shipmentStopActive : ''}`}>
                  <div className={styles.shipmentStopHeader}>
                    <span className={styles.shipmentStopBadge}>Stop {stop.sequence}</span>
                    <span className={styles.shipmentStopStatus}>{statusLabel(stop.status)}</span>
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
  );
}

// useSearchParams needs a Suspense boundary above it.
export default function TrackPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading your deliveries…" />}>
      <Track />
    </Suspense>
  );
}
