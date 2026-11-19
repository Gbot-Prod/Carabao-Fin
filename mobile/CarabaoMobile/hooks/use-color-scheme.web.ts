import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
const subscribeNever = () => () => {};

export function useColorScheme(): 'light' | 'dark' {
  // false while static rendering on the server, true on the client.
  const hasHydrated = useSyncExternalStore(subscribeNever, () => true, () => false);

  const colorScheme = useRNColorScheme();

  if (hasHydrated) {
    return colorScheme === 'dark' ? 'dark' : 'light';
  }

  return 'light';
}
