// Shared with mobile/CarabaoMobile/src/lib/config.ts. Keep both copies the same (sharedCopies.test.ts).
// FastAPI backend. Not the Next.js site — that serves HTML 404s for API paths.
// On a physical device "localhost" is the phone itself, so set EXPO_PUBLIC_API_URL
// (e.g. your PC's LAN IP for local dev) rather than relying on this fallback.
//
// CF-0103: both values are checked at start-up (checkBaseUrl). A production build
// (__DEV__ false) with an http or malformed value stops at launch with an error
// that names the setting: it never sends the session token over cleartext.
// Each process.env.EXPO_PUBLIC_* stays written out in full: Expo inlines them at build time.
import { Platform } from 'react-native';
import { checkBaseUrl } from './baseUrl';

const production = !__DEV__;
// TEMPORARY (demo): Expo web in a browser can use its own web URL (a localhost
// auth proxy), while a phone uses EXPO_PUBLIC_WEB_URL. Unset = no change.
const browserWebUrl = Platform.OS === 'web' ? process.env.EXPO_PUBLIC_WEB_URL_BROWSER : undefined;

export const API_BASE = checkBaseUrl(
  'EXPO_PUBLIC_API_URL',
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000',
  production,
);
// The Next.js site. Also where sign-in lives (BetterAuth at /api/auth).
export const WEB_BASE = checkBaseUrl(
  'EXPO_PUBLIC_WEB_URL',
  browserWebUrl || process.env.EXPO_PUBLIC_WEB_URL || 'http://localhost:3000',
  production,
);
