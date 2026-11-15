// FastAPI backend. Not the Next.js site — that serves HTML 404s for API paths.
// On a physical device "localhost" is the phone itself, so set EXPO_PUBLIC_API_URL
// (e.g. your PC's LAN IP for local dev) rather than relying on this fallback.
export const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');
// The Next.js site. Also where sign-in lives (BetterAuth at /api/auth).
export const WEB_BASE = (process.env.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
