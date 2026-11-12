"use client";

import Link from 'next/link';
import { useCallback, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import RouteMap from '@/components/RouteMap/RouteMap';
import SkeletonList, { LoadError } from '@/components/Skeleton/Skeleton';
import { useVisiblePoll } from '@/hooks/useVisiblePoll';
import { useLanguage } from '@/lib/i18n/LanguageProvider';
import { fmt } from '@/lib/i18n/format';
import { fetchShipmentTracking, type ShipmentStop } from '@/util/api';
import { getApiErrorStatus } from '@/util/errorHelper';
import { googleMapsDirectionsUrl, isNavigable, wazeNavigationUrl } from '@/util/navigation';
import { isClosedStatus, isRouteFinished, statusLabel } from '@/util/tracking';
import dash from '../../page.module.css';
import styles from './page.module.css';

// Merchant/driver view of one shipment: every stop in ALNS order, with
// turn-by-turn links per stop. Positions and arrival times are estimated from
// the planned schedule; there is no live GPS.

const POLL_MS = 30_000;

const formatDuration = (seconds: number) => {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
};

const formatTime = (iso: string | null | undefined) => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const chipClass = (status: string) => {
  if (status === 'delivered') return styles.chipDone;
  if (status === 'cancelled') return styles.chipCancelled;
  return styles.chipOpen;
};

const parseShipmentId = (raw: string | string[] | undefined) => {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(value) && value > 0 ? value : null;
};

export default function RoutingPage() {
  const { t } = useLanguage();
  const params = useParams<{ shipmentId: string }>();
  const shipmentId = parseShipmentId(params?.shipmentId);

  const fetcher = useCallback(
    () => fetchShipmentTracking(shipmentId ?? 0),
    [shipmentId],
  );
  const { data: tracking, error, loaded, updatedAt, retry } = useVisiblePoll(
    shipmentId ? fetcher : null,
    isRouteFinished,
    POLL_MS,
  );

  const errorStatus = error ? getApiErrorStatus(error) : null;
  // The backend answers 404 both for non-merchants and for another merchant's shipment.
  const notFound = shipmentId === null || (!tracking && errorStatus === 404);

  const header = (details?: ReactNode) => (
    <header className={styles.header}>
      <Link className={styles.backLink} href="/merchantDashboard">← {t.routing.back}</Link>
      <h1 className={styles.title}>{t.routing.title}</h1>
      {details}
    </header>
  );

  if (notFound) {
    return (
      <div className={styles.page}>
        {header()}
        <div className={styles.statePanel}>
          <h2 className={styles.stateTitle}>{t.routing.notFoundTitle}</h2>
          <p className={styles.stateText}>{t.routing.notFoundBody}</p>
          <Link className={dash.secondaryBtn} href="/merchantDashboard">{t.routing.back}</Link>
        </div>
      </div>
    );
  }

  if (!tracking) {
    return (
      <div className={styles.page}>
        {header()}
        {!loaded ? (
          <SkeletonList label={t.routing.loading} rows={3} />
        ) : errorStatus === 412 ? (
          <div className={styles.statePanel}>
            <p className={styles.stateText}>{t.routing.notReady}</p>
          </div>
        ) : (
          <LoadError message={t.routing.loadError} onRetry={retry} />
        )}
      </div>
    );
  }

  const stops: ShipmentStop[] = [...tracking.stops].sort((a, b) => a.sequence - b.sequence);
  const doneCount = stops.filter((stop) => isClosedStatus(stop.status)).length;
  const nextStop = stops.find((stop) => !isClosedStatus(stop.status)) ?? null;
  const finished = isRouteFinished(tracking);
  const duration = tracking.total_duration_seconds;
  const updated = updatedAt
    ? new Date(updatedAt).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <div className={styles.page}>
      {header(<>
        <p className={styles.meta}>
          <strong>{fmt(t.routing.shipment, { id: tracking.shipment_id })}</strong>
          <span aria-hidden="true">·</span>
          <span>{fmt(t.routing.stopsDone, { done: doneCount, total: stops.length })}</span>
          {duration ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{fmt(t.routing.plannedDuration, { duration: formatDuration(duration) })}</span>
            </>
          ) : null}
        </p>
        <p className={styles.note}>{t.routing.honestyNote}</p>
      </>)}

      <div className={styles.layout}>
        <section className={styles.stopsPane} aria-labelledby="routing-stops-heading">
          <div className={styles.stopsHead}>
            <h2 id="routing-stops-heading" className={styles.stopsTitle}>{t.routing.stopsHeading}</h2>
            {updated && <span className={styles.updated}>{fmt(t.routing.updated, { time: updated })}</span>}
          </div>
          {finished && <p className={styles.allDone}>{t.routing.allDone}</p>}

          <ol className={styles.stopList}>
            {stops.map((stop) => {
              const closed = isClosedStatus(stop.status);
              const isNext = stop.order_id === nextStop?.order_id;
              const arrival = formatTime(stop.estimated_arrival_at);
              const canNavigate = !closed && isNavigable(stop.lat, stop.lng);
              const className = [
                styles.stop,
                closed ? styles.stopClosed : '',
                isNext ? styles.stopNext : '',
              ].filter(Boolean).join(' ');

              return (
                <li key={stop.order_id} className={className} aria-current={isNext ? 'step' : undefined}>
                  <div className={styles.stopRow}>
                    <span className={styles.seq} aria-label={fmt(t.routing.stop, { n: stop.sequence })}>
                      {stop.sequence}
                    </span>
                    <div className={styles.stopBody}>
                      {isNext && <span className={styles.nextBadge}>{t.routing.nextStop}</span>}
                      <p className={styles.buyer}>{stop.buyer_name ?? stop.label}</p>
                      <p className={styles.address}>{stop.delivery_address ?? t.routing.addressUnavailable}</p>
                      <p className={styles.arrival}>
                        {arrival ? fmt(t.routing.plannedArrival, { time: arrival }) : t.routing.noEstimate}
                      </p>
                    </div>
                    <span className={`${styles.chip} ${chipClass(stop.status)}`}>{statusLabel(stop.status)}</span>
                  </div>

                  {canNavigate && (
                    <div className={styles.navRow}>
                      <a
                        className={`${dash.primaryBtn} ${styles.navBtn}`}
                        href={googleMapsDirectionsUrl(stop.lat, stop.lng)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={fmt(t.routing.navigateTo, { n: stop.sequence })}
                      >
                        {t.routing.navigate}
                      </a>
                      <a
                        className={`${dash.secondaryBtn} ${styles.navBtn}`}
                        href={wazeNavigationUrl(stop.lat, stop.lng)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={fmt(t.routing.wazeTo, { n: stop.sequence })}
                      >
                        {t.routing.waze}
                      </a>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        <section className={styles.mapPane}>
          <RouteMap
            tracking={tracking}
            highlightOrderId={nextStop?.order_id ?? null}
            highlightLabel={t.routing.nextStop}
          />
        </section>
      </div>
    </div>
  );
}
