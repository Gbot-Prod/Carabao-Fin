/// <reference types="google.maps" />
// The map under the pin picker (components/MapPinPicker), for Google Maps or Mapbox GL.
// The picker keeps all the pin rules; this file only draws the map, the pin and the road
// marker, and reports clicks and drags. Both libraries load only in the browser.

import { loadGoogleMaps, onGoogleAuthFailure } from './googleLoader';
import { GOOGLE_MAP_ID, MAP_PROVIDER, mapKey, type MapProvider } from './provider';

export type MapPin = { lat: number; lng: number };

export type PinMapOptions = {
  container: HTMLDivElement;
  center: MapPin;
  zoom: number;
  draggable: boolean;
  pinColor: string;
  roadColor: string;
  /** The road marker's accessible name. */
  roadLabel: string;
  onClick: (pin: MapPin) => void;
  onDragEnd: (pin: MapPin) => void;
  /** The map cannot be drawn (key refused, style or tiles failed). */
  onError: () => void;
};

export type PinMap = {
  /** Show the pin at a point, or take it off the map (null). */
  setPin: (pin: MapPin | null) => void;
  /** Where the pin is shown now, or null when it is not on the map. */
  pinShownAt: () => MapPin | null;
  setPinDraggable: (draggable: boolean) => void;
  /** Show the road marker (where the rider stops), or hide it (null). */
  setRoad: (pin: MapPin | null) => void;
  flyTo: (pin: MapPin, zoom: number) => void;
  getZoom: () => number;
  destroy: () => void;
};

export function createPinMap(options: PinMapOptions, provider: MapProvider = MAP_PROVIDER): Promise<PinMap> {
  return provider === 'google' ? googlePinMap(options) : mapboxPinMap(options);
}

async function mapboxPinMap(o: PinMapOptions): Promise<PinMap> {
  const { default: mapbox } = await import('mapbox-gl');
  mapbox.accessToken = mapKey('mapbox');
  const map = new mapbox.Map({
    container: o.container,
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [o.center.lng, o.center.lat],
    zoom: o.zoom,
  });
  map.addControl(new mapbox.NavigationControl({ showCompass: false }), 'top-right');
  map.on('error', o.onError);
  const marker = new mapbox.Marker({ draggable: o.draggable, color: o.pinColor });
  const road = new mapbox.Marker({ color: o.roadColor, scale: 0.7 });
  road.getElement().setAttribute('aria-label', o.roadLabel);
  road.getElement().title = o.roadLabel;
  marker.on('dragend', () => {
    const { lng, lat } = marker.getLngLat();
    o.onDragEnd({ lat, lng });
  });
  map.on('click', (e) => o.onClick({ lat: e.lngLat.lat, lng: e.lngLat.lng }));

  return {
    setPin: (pin) => {
      if (pin) marker.setLngLat([pin.lng, pin.lat]).addTo(map);
      else marker.remove();
    },
    pinShownAt: () => {
      if (!marker.getElement().isConnected) return null;
      const shown = marker.getLngLat?.();
      return shown ? { lat: shown.lat, lng: shown.lng } : null;
    },
    setPinDraggable: (draggable) => marker.setDraggable(draggable),
    setRoad: (pin) => {
      if (pin) road.setLngLat([pin.lng, pin.lat]).addTo(map);
      else road.remove();
    },
    flyTo: (pin, zoom) => map.flyTo({ center: [pin.lng, pin.lat], zoom }),
    getZoom: () => map.getZoom(),
    destroy: () => map.remove(),
  };
}

/** A Google marker position as a plain pin. */
export function googlePosition(
  position: google.maps.LatLng | google.maps.LatLngLiteral | google.maps.LatLngAltitudeLiteral | null | undefined,
): MapPin | null {
  if (!position) return null;
  if (typeof (position as google.maps.LatLng).lat === 'function') {
    const latLng = position as google.maps.LatLng;
    return { lat: latLng.lat(), lng: latLng.lng() };
  }
  const literal = position as google.maps.LatLngLiteral;
  return { lat: literal.lat, lng: literal.lng };
}

async function googlePinMap(o: PinMapOptions): Promise<PinMap> {
  await loadGoogleMaps(mapKey('google'));
  const [{ Map }, { AdvancedMarkerElement, PinElement }] = await Promise.all([
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
    // A click on a shop or landmark icon places the pin; it does not open Google's card.
    clickableIcons: false,
  });
  const pinGlyph = new PinElement({ background: o.pinColor, borderColor: o.roadColor, glyphColor: '#ffffff' });
  const marker = new AdvancedMarkerElement({ content: pinGlyph.element, gmpDraggable: o.draggable });
  const roadGlyph = new PinElement({ background: o.roadColor, borderColor: o.roadColor, glyphColor: '#ffffff', scale: 0.7 });
  const road = new AdvancedMarkerElement({ content: roadGlyph.element, title: o.roadLabel });
  roadGlyph.element.setAttribute('aria-label', o.roadLabel);
  marker.addListener('dragend', () => {
    const pin = googlePosition(marker.position);
    if (pin) o.onDragEnd(pin);
  });
  map.addListener('click', (e: google.maps.MapMouseEvent) => {
    if (e.latLng) o.onClick({ lat: e.latLng.lat(), lng: e.latLng.lng() });
  });

  return {
    setPin: (pin) => {
      marker.position = pin;
      marker.map = pin ? map : null;
    },
    pinShownAt: () => (marker.map ? googlePosition(marker.position) : null),
    setPinDraggable: (draggable) => {
      marker.gmpDraggable = draggable;
    },
    setRoad: (pin) => {
      road.position = pin;
      road.map = pin ? map : null;
    },
    flyTo: (pin, zoom) => {
      map.setZoom(zoom);
      map.panTo(pin);
    },
    getZoom: () => map.getZoom() ?? o.zoom,
    destroy: () => {
      stopAuthWatch();
      marker.map = null;
      road.map = null;
      google.maps.event.clearInstanceListeners(map);
      o.container.replaceChildren();
    },
  };
}
