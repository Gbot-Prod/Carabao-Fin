import type { ConfigContext, ExpoConfig } from 'expo/config';

const MAPS_PLUGIN = 'react-native-maps';

// app.json cannot read environment variables, so the optional Android Google Maps key is added
// here. iOS uses Apple Maps and needs no key. Without a key react-native-maps still builds; the
// route screen shows the stop list and a "Map not available" note on Android (decision D3).
export default ({ config }: ConfigContext): ExpoConfig => {
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY;
  // app.json is the static base and the CLI passes it in here, so name/slug exist at runtime.
  const staticConfig = config as ExpoConfig;
  if (!apiKey) return staticConfig;

  return {
    ...staticConfig,
    plugins: (staticConfig.plugins ?? []).map((plugin) => {
      const name = Array.isArray(plugin) ? plugin[0] : plugin;
      return name === MAPS_PLUGIN ? [MAPS_PLUGIN, { androidGoogleMapsApiKey: apiKey }] : plugin;
    }),
  };
};
