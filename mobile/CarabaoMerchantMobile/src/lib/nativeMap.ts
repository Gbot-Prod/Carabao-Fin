// src/lib/nativeMap.ts
// The map settings for this device: mapProvider.ts gives the rules, this file gives the platform
// and whether the app runs in Expo Go. It imports expo-constants, so the tests use mapProvider.ts.
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { effectiveMapProvider, isMapAvailable, MAP_PROVIDER } from './mapProvider';

const IN_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const PROVIDER = effectiveMapProvider(MAP_PROVIDER, Platform.OS, IN_EXPO_GO);

/** True: pass PROVIDER_GOOGLE to MapView. */
export const USE_GOOGLE_MAPS = PROVIDER === 'google';

/** Apple Maps needs no key; Expo Go on Android has its own Google Maps key. */
export const MAP_AVAILABLE = PROVIDER === 'native' && Platform.OS === 'ios'
  ? true
  : IN_EXPO_GO || isMapAvailable(Platform.OS);
