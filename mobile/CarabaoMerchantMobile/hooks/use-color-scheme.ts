// Shared with mobile/CarabaoMobile/hooks/use-color-scheme.ts. Keep both copies the same (sharedCopies.test.ts).
import { useColorScheme as useRNColorScheme } from 'react-native';

// React Native can also report 'unspecified' (and null); treat both as light.
export function useColorScheme(): 'light' | 'dark' {
  return useRNColorScheme() === 'dark' ? 'dark' : 'light';
}
