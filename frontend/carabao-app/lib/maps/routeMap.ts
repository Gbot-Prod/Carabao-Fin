/// <reference types="google.maps" />
// The map under components/RouteMap (buyer tracking, merchant routing), for Google Maps
// or Mapbox GL. RouteMap keeps the route rules; this file only draws the road line, the
// numbered stops and the estimated position. Both libraries load only in the browser.

import type { Feature, LineString } from 'geojson';
import { loadGoogleMaps, onGoogleAuthFailure } from './googleLoader';
import { GOOGLE_MAP_ID, MAP_PROVIDER, mapKey, type MapProvider } from './provider';

export type StopMarker = { lng: number; lat: number; color: string; text: string; label: string };

export type RouteMapOptions = {
  container: HTMLDivElement;
  center: { lat: number; lng: number };
  zoom: number;
  lineColor: string;
  /** CSS classes for the stop and position markers (RouteMap.module.css). */
  stopClass: string;
  positionClass: string;
  onError: () => void;
};

export type RouteMapHandle = {
  setRoute: (route: Feature<LineString> | null) => void;
  /** Replaces every stop marker. */
  setStops: (stops: StopMarker[]) => void;
  /** Frame these points (padding 80 px, zoom 14 at most). */
  fitTo: (points: { lat: number; lng: number }[]) => void;
  /** The estimated position, [lng, lat], with its popup text. */
  setPosition: (lngLat: [number, number], label: string, popup: string) => void;
  destroy: () => void;
};

const FIT_PADDING = 80;
const FIT_MAX_ZOOM = 14;

export function createRouteMap(options: RouteMapOptions, provider: MapProvider = MAP_PROVIDER): Promise<RouteMapHandle> {
  return provider === 'google' ? googleRouteMap(options) : mapboxRouteMap(options);
}

function markerElement(className: string, label: string, text = '', color?: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  if (color) el.style.backgroundColor = color;
  el.textContent = text;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);
  return el;
}

const ROUTE_SOURCE = 'shipment-route';
const ROUTE_LAYER = 'shipment-route-line';

async function mapboxRouteMap(o: RouteMapOptions): Promise<RouteMapHandle> {
  const { default: mapboxgl } = await import('mapbox-gl');
  mapboxgl.accessToken = mapKey('mapbox');
  const map = new mapboxgl.Map({
    container: o.container,
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [o.center.lng, o.center.lat],
    zoom: o.zoom,
  });
  map.on('error', (event) => {
    if (event.error) console.error('[route-map] Mapbox map error:', event.error);
    o.onError();
  });
  map.addControl(new mapboxgl.NavigationControl(), 'top-right');
  // The pane is flex/grid-sized, so keep the canvas in sync with its container.
  const resizeObserver = new ResizeObserver(() => map.resize());
  resizeObserver.observe(o.container);

  // Layers can be added only once the style has loaded; keep the newest route until then.
  let styleLoaded = false;
  let route: Feature<LineString> | null = null;
  const drawRoute = () => {
    if (!styleLoaded) return;
    const source = map.getSource(ROUTE_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (route) {
      if (source) {
        source.setData(route);
      } else {
        map.addSource(ROUTE_SOURCE, { type: 'geojson', data: route });
        map.addLayer({
          id: ROUTE_LAYER,
          type: 'line',
          source: ROUTE_SOURCE,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': o.lineColor, 'line-width': 4, 'line-opacity': 0.85 },
        });
      }
    } else if (source) {
      if (map.getLayer(ROUTE_LAYER)) map.removeLayer(ROUTE_LAYER);
      map.removeSource(ROUTE_SOURCE);
    }
  };
  map.on('load', () => {
    styleLoaded = true;
    drawRoute();
  });

  let stops: mapboxgl.Marker[] = [];
  let position: mapboxgl.Marker | null = null;

  return {
    setRoute: (next) => {
      route = next;
      drawRoute();
    },
    setStops: (specs) => {
      stops.forEach((marker) => marker.remove());
      stops = specs.map((spec) =>
        new mapboxgl.Marker({ element: markerElement(o.stopClass, spec.label, spec.text, spec.color) })
          .setLngLat([spec.lng, spec.lat])
          .setPopup(new mapboxgl.Popup({ offset: 18 }).setText(spec.label))
          .addTo(map),
      );
    },
    fitTo: (points) => {
      if (points.length === 0) return;
      const bounds = new mapboxgl.LngLatBounds();
      points.forEach((p) => bounds.extend([p.lng, p.lat]));
      map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM });
    },
    setPosition: (lngLat, label, popup) => {
      if (position) {
        position.setLngLat(lngLat);
        return;
      }
      position = new mapboxgl.Marker({ element: markerElement(o.positionClass, label) })
        .setLngLat(lngLat)
        .setPopup(new mapboxgl.Popup({ offset: 14 }).setText(popup))
        .addTo(map);
    },
    destroy: () => {
      resizeObserver.disconnect();
      position?.remove();
      stops.forEach((marker) => marker.remove());
      map.remove();
    },
  };
}

async function googleRouteMap(o: RouteMapOptions): Promise<RouteMapHandle> {
  await loadGoogleMaps(mapKey('google'));
  const [{ Map, InfoWindow, Polyline }, { AdvancedMarkerElement }] = await Promise.all([
    google.maps.importLibrary('maps') as Promise<google.maps.MapsLibrary>,
    google.maps.importLibrary('marker') as Promise<google.maps.MarkerLibrary>,
  ]);
  const stopAuthWatch = onGoogleAuthFailure(o.onError);
  const map = new Map(o.container, {
    center: o.center,
    zoom: o.zoom,
    mapId: GOOGLE_MAP_ID,
    disableDefaultUI: true,
    zoomControl: true,
    fullscreenControl: true,
    clickableIcons: false,
  });
  const info = new InfoWindow();
  const line = new Polyline({ strokeColor: o.lineColor, strokeWeight: 4, strokeOpacity: 0.85 });

  // Google anchors marker content at its bottom centre; Mapbox at its centre. Move the
  // round markers down by half their height so both put the centre on the point.
  const centred = (el: HTMLDivElement) => {
    el.style.transform = 'translateY(50%)';
    return el;
  };
  const withPopup = (marker: google.maps.marker.AdvancedMarkerElement, text: string) => {
    marker.addListener('click', () => {
      info.setContent(text);
      info.open({ anchor: marker, map });
    });
    return marker;
  };

  let stops: google.maps.marker.AdvancedMarkerElement[] = [];
  let position: google.maps.marker.AdvancedMarkerElement | null = null;

  return {
    setRoute: (route) => {
      if (!route) {
        line.setMap(null);
        return;
      }
      line.setPath(route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })));
      line.setMap(map);
    },
    setStops: (specs) => {
      stops.forEach((marker) => (marker.map = null));
      stops = specs.map((spec) =>
        withPopup(
          new AdvancedMarkerElement({
            map,
            position: { lat: spec.lat, lng: spec.lng },
            content: centred(markerElement(o.stopClass, spec.label, spec.text, spec.color)),
            title: spec.label,
          }),
          spec.label,
        ),
      );
    },
    fitTo: (points) => {
      if (points.length === 0) return;
      const bounds = new google.maps.LatLngBounds();
      points.forEach((p) => bounds.extend(p));
      map.fitBounds(bounds, FIT_PADDING);
      google.maps.event.addListenerOnce(map, 'idle', () => {
        if ((map.getZoom() ?? 0) > FIT_MAX_ZOOM) map.setZoom(FIT_MAX_ZOOM);
      });
    },
    setPosition: ([lng, lat], label, popup) => {
      if (position) {
        position.position = { lat, lng };
        return;
      }
      position = withPopup(
        new AdvancedMarkerElement({
          map,
          position: { lat, lng },
          content: centred(markerElement(o.positionClass, label)),
          title: label,
        }),
        popup,
      );
    },
    destroy: () => {
      stopAuthWatch();
      info.close();
      line.setMap(null);
      stops.forEach((marker) => (marker.map = null));
      if (position) position.map = null;
      google.maps.event.clearInstanceListeners(map);
      o.container.replaceChildren();
    },
  };
}
