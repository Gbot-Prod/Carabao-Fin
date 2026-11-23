// src/components/RouteMapView.web.tsx
// S12: react-native-maps has no web implementation, so the browser preview (`npm run web`) shows
// a note where the map would be. Android and iOS bundle RouteMapView.tsx instead. Both files
// export the same default and share the prop types, so RouteScreen does not branch on platform.
import React from 'react';
import { WEB_MAP_NOTE } from '../lib/route';
import { MapUnavailable } from './MapUnavailable';
import type { RouteMapViewProps } from './RouteMapView';

export type { RouteMapMarker, RouteMapViewProps } from './RouteMapView';

export default function RouteMapView(_props: RouteMapViewProps) {
  return <MapUnavailable note={WEB_MAP_NOTE} />;
}
