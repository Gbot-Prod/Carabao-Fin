/// <reference types="google.maps" />
// Loads the Google Maps JavaScript API once, in the browser only.
// The script is added by our own (nonced) code, so the CSP's 'strict-dynamic' allows it.

const CALLBACK = '__carabaoGoogleMapsReady';

type MapsWindow = Window & {
  google?: typeof google;
  [CALLBACK]?: () => void;
  gm_authFailure?: () => void;
};

let loading: Promise<void> | null = null;
const authFailureListeners = new Set<() => void>();

/** Called when Google refuses the key (wrong referrer, API not enabled, billing). */
export function onGoogleAuthFailure(listener: () => void): () => void {
  authFailureListeners.add(listener);
  return () => authFailureListeners.delete(listener);
}

export function loadGoogleMaps(key: string): Promise<void> {
  const win = window as MapsWindow;
  if (win.google?.maps?.importLibrary) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    win[CALLBACK] = () => resolve();
    win.gm_authFailure = () => authFailureListeners.forEach((listener) => listener());
    const script = document.createElement('script');
    const params = new URLSearchParams({ key, v: 'weekly', loading: 'async', callback: CALLBACK, region: 'PH' });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('Google Maps did not load'));
    };
    document.head.appendChild(script);
  });
  return loading;
}
