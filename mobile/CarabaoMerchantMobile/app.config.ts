import type { ConfigContext, ExpoConfig } from 'expo/config';
import { chooseMapProvider } from './src/lib/mapProvider';

const MAPS_PLUGIN = 'react-native-maps';

// app.json cannot read environment variables, so the Google Maps key is added here.
// EXPO_PUBLIC_MAP_PROVIDER (src/lib/mapProvider.ts): google (the default with a key) gives the key
// to Android and iOS, so iOS draws Google Maps too; native gives it to Android only, and iOS draws
// Apple Maps. Without a key react-native-maps still builds; a Google map shows the stop list and
// a "Map not available" note (decision D3).
export default ({ config }: ConfigContext): ExpoConfig => {
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY;
  // app.json is the static base and the CLI passes it in here, so name/slug exist at runtime.
  const staticConfig = config as ExpoConfig;
  if (!apiKey) return staticConfig;
  const provider = chooseMapProvider(process.env.EXPO_PUBLIC_MAP_PROVIDER, true);
  const keys =
    provider === 'google'
      ? { androidGoogleMapsApiKey: apiKey, iosGoogleMapsApiKey: apiKey }
      : { androidGoogleMapsApiKey: apiKey };

  return {
    ...staticConfig,
    plugins: (staticConfig.plugins ?? []).map((plugin) => {
      const name = Array.isArray(plugin) ? plugin[0] : plugin;
      return name === MAPS_PLUGIN ? [MAPS_PLUGIN, keys] : plugin;
    }),
  };
};
