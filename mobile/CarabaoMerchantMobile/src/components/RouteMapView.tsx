// src/components/RouteMapView.tsx
// S12 (plan §5.4, part 2): the road map itself, drawn with react-native-maps. RouteScreen supplies
// the geometry (`GET /shipments/{id}/route`), the numbered stops and the pins; this file only
// draws them, so the screen stays testable and the pure rules live in src/lib/routeMap.ts.
// RouteMapView.web.tsx replaces it in the browser preview (`npm run web`), where
// react-native-maps has no implementation.
// Decision D3: Google Maps (Android, and iOS when EXPO_PUBLIC_MAP_PROVIDER is google) draws only
// with a key (app.config.ts passes EXPO_PUBLIC_GOOGLE_MAPS_KEY to the plugin); without one the
// note and the stop list stand in. src/lib/mapProvider.ts has the switch.
import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, Polyline } from 'react-native-maps';
import {
  CLOSED_STOP_COLOR,
  POSITION_COLOR,
  type LatLng,
  type MapRegion,
} from '../lib/routeMap';
import { MAP_AVAILABLE, USE_GOOGLE_MAPS } from '../lib/nativeMap';
import { MAP_KEY_NOTE } from '../lib/route';
import { Colors, FontSize, Radius } from '../lib/theme';
import { MapUnavailable } from './MapUnavailable';

export type RouteMapMarker = {
  /** Unique per marker: the pickup, or a stop's order. */
  key: string;
  coordinate: LatLng;
  /** `P` for the pickup, the stop's number otherwise. */
  text: string;
  /** One of the routeMap colours (pickup, next stop, other stop, closed stop). */
  color: string;
  /** The marker's callout and its accessibility label. */
  label: string;
};

export type RouteMapViewProps = {
  /** The first view: a region holding every point. */
  region: MapRegion | null;
  /** Every pin in route order, the pickup first. */
  points: LatLng[];
  /** The road line from the API; null when the API had none. */
  road: LatLng[] | null;
  markers: RouteMapMarker[];
};


export default function RouteMapView({ region, points, road, markers }: RouteMapViewProps) {
  const mapRef = useRef<MapView | null>(null);

  // Frame every pin when the set of stops changes. RouteScreen hands `points` the same array while
  // the pins are unchanged, so a poll that moves nothing keeps the view the rider moved.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (points.length > 1) {
      map.fitToCoordinates(points, {
        edgePadding: { top: 48, right: 48, bottom: 48, left: 48 },
        animated: true,
      });
    } else if (region) {
      map.animateToRegion(region, 300);
    }
  }, [points, region]);

  if (!MAP_AVAILABLE) return <MapUnavailable note={MAP_KEY_NOTE} />;
  if (!region) return null;

  return (
    <View style={styles.wrap}>
      <MapView
        ref={mapRef}
        provider={USE_GOOGLE_MAPS ? PROVIDER_GOOGLE : undefined}
        style={styles.map}
        initialRegion={region}
        accessibilityLabel="Route map"
      >
        {road && road.length > 1 ? (
          <Polyline coordinates={road} strokeColor={POSITION_COLOR} strokeWidth={4} />
        ) : points.length > 1 ? (
          // No road line: a light straight-line sketch of the stop order, as the web's fallback
          // map does. It is not a road, so it is thin and grey.
          <Polyline coordinates={points} strokeColor={Colors.textLight} strokeWidth={2} />
        ) : null}

        {markers.map((marker) => (
          <Marker
            key={marker.key}
            coordinate={marker.coordinate}
            title={marker.label}
            // Closed stops read grey and sort under the number, so the next stop stands out.
            opacity={marker.color === CLOSED_STOP_COLOR ? 0.7 : 1}
          >
            <View
              accessible
              accessibilityLabel={marker.label}
              style={[styles.pin, { backgroundColor: marker.color }]}
            >
              <Text style={styles.pinText}>{marker.text}</Text>
            </View>
          </Marker>
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
  },
  map: { width: '100%', height: 280 },
  pin: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinText: { color: Colors.white, fontSize: FontSize.xs, fontWeight: '700' },
});
