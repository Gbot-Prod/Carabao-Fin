// Which map library draws the maps in the browser (the pin picker and the route map).
//
// NEXT_PUBLIC_MAP_PROVIDER: "google" or "mapbox". Empty: google when
// NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is set, else mapbox. Geocoding, routes and the road
// check do not run here: the API does them with its own switch (MAPS_PROVIDER).

export type MapProvider = 'google' | 'mapbox';

const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_API_KEY || '';
// Advanced markers need a Map ID. DEMO_MAP_ID is Google's test ID; set a real one for production.
export const GOOGLE_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || 'DEMO_MAP_ID';

function chosen(): MapProvider {
  const value = (process.env.NEXT_PUBLIC_MAP_PROVIDER || '').trim().toLowerCase();
  if (value === 'google' || value === 'mapbox') return value;
  return GOOGLE_KEY ? 'google' : 'mapbox';
}

export const MAP_PROVIDER: MapProvider = chosen();

/** The browser key or token of the chosen provider ('' when not set: no map). */
export const mapKey = (provider: MapProvider = MAP_PROVIDER): string =>
  provider === 'google' ? GOOGLE_KEY : MAPBOX_TOKEN;
