// CF-0117: the one way a screen polls. Runs `tick` at once and then every `ms`
// while the screen is in view and the app is in the foreground (src/lib/polling.ts);
// stops otherwise, and fetches at once when it comes back.
import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useIsFocused } from 'expo-router';
import { shouldPoll } from './polling';

export function usePolling(tick: () => unknown, ms: number, enabled = true): void {
  const focused = useIsFocused();
  // currentState can be null while the app starts; it starts in the foreground.
  const [appState, setAppState] = useState<AppStateStatus | string>(AppState.currentState ?? 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', setAppState);
    return () => sub.remove();
  }, []);

  // The newest callback, without restarting the timer when it changes.
  const tickRef = useRef(tick);
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const run = shouldPoll(focused, appState, enabled);
  useEffect(() => {
    if (!run) return;
    void tickRef.current(); // at once: on first view and on every return
    const id = setInterval(() => void tickRef.current(), ms);
    return () => clearInterval(id);
  }, [run, ms]);
}
