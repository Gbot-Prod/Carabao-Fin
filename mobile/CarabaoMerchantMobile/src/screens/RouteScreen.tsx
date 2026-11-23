// src/screens/RouteScreen.tsx
// S12 (plan §5.4, part 2): the merchant's view of one shipment — the same page as the web
// app/(site)/(merchant)/merchant/(shell)/routing/[shipmentId]/page.tsx. It draws the road line and
// the numbered stops on a map, lists the stops in plan order with Google Maps and Waze links
// (decision D1: one stop per link, because Google caps the waypoints in a directions URL), and
// lets a rider report a pin they cannot get to (pin quality, control 6).
//
// The phone never calls Mapbox: the road line comes from `GET /shipments/{id}/route`, the stops and
// the planned arrivals from `GET /shipments/{id}`, which this screen polls every 30 s until every
// stop is closed. Nothing here is live GPS (the web says so too); the root gate (app/_layout.tsx)
// already checked the farm.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import RouteMapView, { type RouteMapMarker } from '../components/RouteMapView';
import { Badge, Button, EmptyState } from '../components/UI';
import { LoadError, SkeletonList } from '../components/Skeleton';
import { api, ApiError, type ApiShipmentStop, type ApiShipmentTracking } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { usePolling } from '../lib/usePolling';
import {
  googleMapsDirectionsUrl,
  isClosedStatus,
  isNavigable,
  isRouteFinished,
  statusLabel,
  wazeNavigationUrl,
} from '../lib/navigation';
import {
  CLOSED_STOP_COLOR,
  HIGHLIGHT_STOP_COLOR,
  OTHER_STOP_COLOR,
  PICKUP_COLOR,
  parseShipmentId,
  regionForPoints,
  routePolyline,
  stopNumber,
  toLatLng,
  type LatLng,
  type MapRegion,
} from '../lib/routeMap';
import {
  ADDRESS_UNAVAILABLE,
  ALL_DONE,
  APPROXIMATE,
  APPROXIMATE_NOTE,
  BACK_TO_SHIPMENTS,
  CLOSED_STOPS_LEGEND,
  HONESTY_NOTE,
  LINK_ERROR,
  LOADING_ROUTE,
  LOAD_ERROR,
  MAP_LEGEND_LABEL,
  NAVIGATE,
  NEXT_STOP,
  NOT_FOUND_BODY,
  NOT_FOUND_TITLE,
  NOT_READY,
  NO_ESTIMATE,
  OTHER_STOPS_LEGEND,
  PICKUP_LEGEND,
  REPORT_CANCEL,
  REPORTED,
  REPORTED_NOTE,
  REPORT_ERROR,
  REPORT_NOTE_LABEL,
  REPORT_NOTE_MAX,
  REPORT_NOTE_PLACEHOLDER,
  REPORT_PIN,
  REPORT_SEND,
  ROUTE_TITLE,
  STOPS_HEADING,
  WAZE,
  formatArrival,
  formatDuration,
  formatUpdatedAt,
  navigateToLabel,
  plannedArrivalLabel,
  plannedDurationLabel,
  reportPinToLabel,
  shipmentLabel,
  stopLabel,
  stopsDoneLabel,
  updatedLabel,
  wazeToLabel,
} from '../lib/route';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../lib/theme';

// The web's 30 s: the planned schedule does not change faster than that.
const POLL_MS = 30_000;

/** Badge has no exported colour type; this matches it (S10 uses red for payment problems). */
type ChipColor = 'green' | 'blue' | 'yellow' | 'red' | 'gray';

const chipColor = (status: string): ChipColor => {
  if (status === 'delivered') return 'green';
  if (status === 'cancelled') return 'gray';
  if (status === 'payment_mismatch') return 'red';
  return 'yellow';
};

/**
 * "Cannot get to pin" (pin quality, control 6). Opening the form is the confirm: sending needs one
 * more tap, and the backend keeps one report per order, so a second send is a 409 ("already
 * reported"), which is shown as done — the web does the same.
 */
function PinReportForm({
  stop,
  token,
  onDone,
  onCancel,
}: {
  stop: ApiShipmentStop;
  token: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.shipments.reportUnreachablePin(token, stop.order_id, note);
      onDone();
    } catch (err) {
      // 409: already reported, perhaps from another device. Show it as done.
      if (err instanceof ApiError && err.status === 409) onDone();
      else setError(err instanceof Error && err.message ? err.message : REPORT_ERROR);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.reportForm}>
      <Text style={styles.reportLabel}>{REPORT_NOTE_LABEL}</Text>
      <TextInput
        style={styles.reportInput}
        value={note}
        onChangeText={setNote}
        maxLength={REPORT_NOTE_MAX}
        placeholder={REPORT_NOTE_PLACEHOLDER}
        placeholderTextColor={Colors.textLight}
        editable={!busy}
        multiline
        accessibilityLabel={REPORT_NOTE_LABEL}
      />
      {error && (
        <Text style={styles.reportError} accessibilityRole="alert">
          {error}
        </Text>
      )}
      <View style={styles.navRow}>
        <Button label={REPORT_SEND} onPress={send} loading={busy} style={styles.navBtn} />
        <TouchableOpacity
          style={styles.ghostBtn}
          onPress={onCancel}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={REPORT_CANCEL}
        >
          <Text style={styles.ghostBtnText}>{REPORT_CANCEL}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** One dot of the map legend (the web's `Map legend` list). */
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

export default function RouteScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const params = useLocalSearchParams<{ shipmentId?: string }>();
  // A tapped link or a deep link can carry anything; parseShipmentId keeps a positive integer.
  const shipmentId = useMemo(() => parseShipmentId(params.shipmentId), [params.shipmentId]);

  const [tracking, setTracking] = useState<ApiShipmentTracking | null>(null);
  const [loaded, setLoaded] = useState(false);
  // The status of the last failed load: 404 (another farm's shipment), 412 (not routed yet).
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // The road line; reloaded on a pull or a retry, not on every poll.
  const [road, setRoad] = useState<LatLng[] | null>(null);
  const [roadAttempt, setRoadAttempt] = useState(0);
  // The order whose pin report form is open; one at a time, like the web.
  const [reportingOrder, setReportingOrder] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token || shipmentId === null) {
      setLoaded(true);
      return;
    }
    try {
      const next = await api.shipments.tracking(token, shipmentId);
      setTracking(next);
      setErrorStatus(null);
      setErrorText(null);
      setUpdatedAt(Date.now());
    } catch (err) {
      // A failed poll keeps the stops already on screen: an outage is not an empty route.
      setErrorStatus(err instanceof ApiError ? err.status : null);
      setErrorText(err instanceof Error && err.message ? err.message : LOAD_ERROR);
    } finally {
      setLoaded(true);
    }
  }, [token, shipmentId]);

  const stops = useMemo(
    () => (tracking ? [...tracking.stops].sort((a, b) => a.sequence - b.sequence) : []),
    [tracking],
  );
  const finished = tracking !== null && isRouteFinished(tracking);
  // 404: no such shipment, or another farm's — the backend answers the same for both.
  const notFound = shipmentId === null || (!tracking && errorStatus === 404);

  // At once when the screen opens, then every 30 s; stops once every stop is closed.
  usePolling(load, POLL_MS, !notFound && !finished);

  const hasStops = stops.length > 0;
  useEffect(() => {
    if (!token || shipmentId === null || !hasStops) return;
    let active = true;
    api.shipments
      .route(token, shipmentId)
      .then((res) => {
        if (!active) return;
        const line = routePolyline(res.route);
        setRoad(line.length > 1 ? line : null);
      })
      .catch(() => {
        // No line (Mapbox had none, or the call failed): the stops still show, as on the web.
        if (active) setRoad(null);
      });
    return () => {
      active = false;
    };
  }, [token, shipmentId, hasStops, roadAttempt]);

  const retry = useCallback(() => {
    void load();
    setRoadAttempt((n) => n + 1);
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRoadAttempt((n) => n + 1);
    setRefreshing(false);
  }, [load]);

  const nextOrderId = stops.find((stop) => !isClosedStatus(stop.status))?.order_id ?? null;
  const doneCount = stops.filter((stop) => isClosedStatus(stop.status)).length;
  const duration = tracking?.total_duration_seconds ?? null;
  const updated = formatUpdatedAt(updatedAt);
  // The link leaves the app for Maps or Waze; a phone without either says so instead of nothing.
  const openLink = useCallback((url: string) => {
    Linking.openURL(url).catch(() => Alert.alert(LINK_ERROR));
  }, []);
  // A deep link can open this screen with nothing behind it; the Shipments tab is its parent.
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.push('/shipments');
  }, [router]);

  // The markers read the plan's sequence, so the map and the list always agree.
  const markers = useMemo<RouteMapMarker[]>(() => {
    const waypoints = tracking?.waypoints ?? [];
    return waypoints.map((waypoint, index) => {
      const coordinate = toLatLng(waypoint);
      if (waypoint.type === 'pickup') {
        return {
          key: 'pickup',
          coordinate,
          text: 'P',
          color: PICKUP_COLOR,
          label: `${PICKUP_LEGEND}: ${waypoint.label}`,
        };
      }
      // The number counts deliveries only, so a pickup never shifts the stops (routes are small).
      const ordinal = waypoints.slice(0, index).filter((w) => w.type !== 'pickup').length;
      const number = stopNumber(waypoint, ordinal);
      const color = isClosedStatus(waypoint.status)
        ? CLOSED_STOP_COLOR
        : waypoint.order_id != null && waypoint.order_id === nextOrderId
          ? HIGHLIGHT_STOP_COLOR
          : OTHER_STOP_COLOR;
      return {
        key: `stop-${waypoint.order_id ?? index}`,
        coordinate,
        text: String(number),
        color,
        label: `${stopLabel(number)}: ${waypoint.label} · ${statusLabel(waypoint.status)}`,
      };
    });
  }, [tracking, nextOrderId]);

  // `points` is the same array while the pins have not moved, so a poll that changes only a
  // status does not pull the map back to its first framing.
  const pinsKey = useMemo(
    () => JSON.stringify((tracking?.waypoints ?? []).map(({ lat, lng }) => ({ lat, lng }))),
    [tracking],
  );
  const points = useMemo<LatLng[]>(
    () => (JSON.parse(pinsKey) as { lat: number; lng: number }[]).map(toLatLng),
    [pinsKey],
  );
  const region = useMemo<MapRegion | null>(() => regionForPoints(points), [points]);

  const header = (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={goBack}
        style={styles.back}
        accessibilityRole="button"
        accessibilityLabel={BACK_TO_SHIPMENTS}
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={24} color={Colors.text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{ROUTE_TITLE}</Text>
      {tracking && (
        <Badge
          label={stopsDoneLabel(doneCount, stops.length)}
          color={finished ? 'green' : 'blue'}
        />
      )}
    </View>
  );

  if (notFound) {
    return (
      <SafeAreaView style={styles.root}>
        {header}
        <EmptyState
          icon={<Ionicons name="alert-circle-outline" size={56} color={Colors.textLight} />}
          title={NOT_FOUND_TITLE}
          message={NOT_FOUND_BODY}
          action={
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => router.push('/shipments')}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryBtnText}>{BACK_TO_SHIPMENTS}</Text>
            </TouchableOpacity>
          }
        />
      </SafeAreaView>
    );
  }

  if (!tracking) {
    return (
      <SafeAreaView style={styles.root}>
        {header}
        {!loaded ? (
          <SkeletonList label={LOADING_ROUTE} rows={3} />
        ) : errorStatus === 412 ? (
          <View style={styles.statePanel}>
            <Text style={styles.stateText}>{NOT_READY}</Text>
          </View>
        ) : (
          <LoadError message={errorText ?? LOAD_ERROR} onRetry={retry} />
        )}
      </SafeAreaView>
    );
  }

  const metaLine = [
    shipmentLabel(tracking.shipment_id),
    stopsDoneLabel(doneCount, stops.length),
    duration ? plannedDurationLabel(formatDuration(duration)) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <SafeAreaView style={styles.root}>
      {header}
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.xxl }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={Colors.primary}
          />
        }
      >
        <View style={styles.metaBlock}>
          <Text style={styles.meta}>{metaLine}</Text>
          <Text style={styles.note}>{HONESTY_NOTE}</Text>
          {updated && <Text style={styles.updated}>{updatedLabel(updated)}</Text>}
        </View>

        <View style={styles.mapPanel}>
          <RouteMapView region={region} points={points} road={road} markers={markers} />
          <Text style={styles.legendTitle}>{MAP_LEGEND_LABEL}</Text>
          <View style={styles.legend}>
            <LegendDot color={PICKUP_COLOR} label={PICKUP_LEGEND} />
            <LegendDot color={HIGHLIGHT_STOP_COLOR} label={NEXT_STOP} />
            <LegendDot color={OTHER_STOP_COLOR} label={OTHER_STOPS_LEGEND} />
            <LegendDot color={CLOSED_STOP_COLOR} label={CLOSED_STOPS_LEGEND} />
          </View>
        </View>

        <View style={styles.stopsHead}>
          <Text style={styles.stopsTitle}>{STOPS_HEADING}</Text>
          <Text style={styles.updated}>{stopsDoneLabel(doneCount, stops.length)}</Text>
        </View>
        {finished && <Text style={styles.allDone}>{ALL_DONE}</Text>}

        {stops.map((stop, index) => {
          const closed = isClosedStatus(stop.status);
          const isNext = !closed && stop.order_id === nextOrderId;
          const number = stopNumber(stop, index);
          const navigable = isNavigable(stop.lat, stop.lng);
          const arrival = formatArrival(stop.estimated_arrival_at);
          return (
            <View
              key={stop.order_id}
              style={[styles.stop, closed && styles.stopClosed, isNext && styles.stopNext]}
            >
              <View style={styles.stopRow}>
                <View style={[styles.seq, closed && styles.seqClosed, isNext && styles.seqNext]}>
                  <Text style={[styles.seqText, isNext && styles.seqTextNext]}>{number}</Text>
                </View>
                <View style={styles.stopBody}>
                  {isNext && <Text style={styles.nextBadge}>{NEXT_STOP}</Text>}
                  <Text style={styles.buyer}>{stop.buyer_name ?? stop.label}</Text>
                  <Text style={styles.address}>{stop.delivery_address ?? ADDRESS_UNAVAILABLE}</Text>
                  <Text style={styles.arrival}>
                    {arrival ? plannedArrivalLabel(arrival) : NO_ESTIMATE}
                  </Text>
                </View>
                <Badge label={statusLabel(stop.status)} color={chipColor(stop.status)} />
              </View>

              {stop.pin_approximate && (
                <Text style={styles.approximateNote}>
                  <Text style={styles.noteStrong}>{APPROXIMATE}. </Text>
                  {APPROXIMATE_NOTE}
                </Text>
              )}

              {!closed && navigable && (
                <View style={styles.navRow}>
                  <TouchableOpacity
                    style={styles.navPrimary}
                    onPress={() => openLink(googleMapsDirectionsUrl(stop.lat, stop.lng))}
                    accessibilityRole="link"
                    accessibilityLabel={navigateToLabel(number)}
                  >
                    <Ionicons name="navigate" size={16} color={Colors.white} />
                    <Text style={styles.navPrimaryText}>{NAVIGATE}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.secondaryBtn}
                    onPress={() => openLink(wazeNavigationUrl(stop.lat, stop.lng))}
                    accessibilityRole="link"
                    accessibilityLabel={wazeToLabel(number)}
                  >
                    <Text style={styles.secondaryBtnText}>{WAZE}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {!closed &&
                (stop.pin_unreachable ? (
                  <Text style={styles.reportedNote}>
                    <Text style={styles.noteStrong}>{REPORTED}. </Text>
                    {REPORTED_NOTE}
                  </Text>
                ) : reportingOrder === stop.order_id ? (
                  <PinReportForm
                    stop={stop}
                    token={token}
                    onDone={() => {
                      setReportingOrder(null);
                      // The flag comes back with the next read; ask now so the note shows at once.
                      void load();
                    }}
                    onCancel={() => setReportingOrder(null)}
                  />
                ) : (
                  <TouchableOpacity
                    style={styles.secondaryBtn}
                    onPress={() => setReportingOrder(stop.order_id)}
                    accessibilityRole="button"
                    accessibilityLabel={reportPinToLabel(number)}
                  >
                    <Text style={styles.secondaryBtnText}>{REPORT_PIN}</Text>
                  </TouchableOpacity>
                ))}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  back: { padding: Spacing.xs },
  headerTitle: { flex: 1, fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  scroll: { padding: Spacing.lg, gap: Spacing.md },
  metaBlock: { gap: Spacing.xs },
  meta: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text, lineHeight: 20 },
  note: { fontSize: FontSize.xs, color: Colors.textMuted, lineHeight: 17 },
  mapPanel: { gap: Spacing.sm },
  legendTitle: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textMuted },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: FontSize.xs, color: Colors.textMuted },
  stopsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stopsTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  updated: { fontSize: FontSize.xs, color: Colors.textMuted },
  allDone: { fontSize: FontSize.sm, color: Colors.primaryDark, lineHeight: 20 },
  stop: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  stopClosed: { opacity: 0.7 },
  stopNext: { borderColor: Colors.warning, borderWidth: 2 },
  stopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  seq: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seqClosed: { backgroundColor: Colors.border },
  seqNext: { backgroundColor: Colors.warning },
  seqText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  seqTextNext: { color: Colors.white },
  stopBody: { flex: 1, gap: 2 },
  nextBadge: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.warning },
  buyer: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  address: { fontSize: FontSize.sm, color: Colors.textMuted, lineHeight: 19 },
  arrival: { fontSize: FontSize.xs, color: Colors.textLight },
  approximateNote: { fontSize: FontSize.xs, color: Colors.textMuted, lineHeight: 17 },
  reportedNote: { fontSize: FontSize.xs, color: Colors.textMuted, lineHeight: 17 },
  noteStrong: { fontWeight: '700', color: Colors.text },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  navPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    minHeight: 40,
    ...Shadow.sm,
  },
  navPrimaryText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.white },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 40,
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  secondaryBtnText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primaryDark },
  reportForm: {
    gap: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingTop: Spacing.sm,
  },
  reportLabel: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textMuted },
  reportInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    fontSize: FontSize.sm,
    color: Colors.text,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  reportError: { fontSize: FontSize.xs, color: Colors.error, lineHeight: 17 },
  navBtn: { flex: 1 },
  ghostBtn: { paddingHorizontal: Spacing.md, minHeight: 44, justifyContent: 'center' },
  ghostBtnText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textMuted },
  statePanel: { padding: Spacing.xxl },
  stateText: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    lineHeight: 20,
    textAlign: 'center',
  },
});







