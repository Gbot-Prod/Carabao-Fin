// src/lib/mapProvider.ts
// Which map SDK react-native-maps draws with (the route map and the address pin map).
//
// EXPO_PUBLIC_MAP_PROVIDER:
//   google - Google Maps on Android and on iOS. Both need EXPO_PUBLIC_GOOGLE_MAPS_KEY, which
//            app.config.ts gives to the react-native-maps plugin for both platforms.
//   native - the platform's map: Apple Maps on iOS (no key), Google Maps on Android (key).
// Empty: google when EXPO_PUBLIC_GOOGLE_MAPS_KEY is set, else native.
// Geocoding, routes and the road check do not run here: the API does them (MAPS_PROVIDER).
// No react-native-maps import here, so a test can import this file without the native module.

export type MobileMapProvider = 'google' | 'native';

export function chooseMapProvider(value: string | undefined, hasKey: boolean): MobileMapProvider {
  const chosen = (value ?? '').trim().toLowerCase();
  if (chosen === 'google' || chosen === 'native') return chosen;
  return hasKey ? 'google' : 'native';
}

/** Whether the map can be drawn: every Google map needs the key; Apple Maps does not. */
export function mapAvailable(provider: MobileMapProvider, os: string, hasKey: boolean): boolean {
  if (provider === 'google') return hasKey;
  return os !== 'android' || hasKey;
}

const HAS_KEY = !!process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY;

export const MAP_PROVIDER: MobileMapProvider = chooseMapProvider(process.env.EXPO_PUBLIC_MAP_PROVIDER, HAS_KEY);


export const isMapAvailable = (os: string): boolean => mapAvailable(MAP_PROVIDER, os, HAS_KEY);

/**
 * The provider the map really draws with. Expo Go on iOS has no Google Maps SDK, so a Google map
 * there is blank: it draws Apple Maps (no key) in its place. A development or store build keeps
 * the chosen provider.
 */
export function effectiveMapProvider(
  provider: MobileMapProvider,
  os: string,
  inExpoGo: boolean,
): MobileMapProvider {
  return provider === 'google' && os === 'ios' && inExpoGo ? 'native' : provider;
}
