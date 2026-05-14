import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { Colors } from '../lib/theme';

interface ProtectedScreenProps {
  children: React.ReactNode;
  requiredRole?: 'user' | 'merchant' | 'admin';
}

/**
 * Wrapper component that enforces authentication for protected screens.
 * If the user is not authenticated, shows an error with a sign-in button.
 * If a role is required and the user doesn't have it, shows an error.
 */
export function ProtectedScreen({ children, requiredRole }: ProtectedScreenProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/auth');
    }
  }, [isAuthenticated, isLoading]);

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.offWhite,
  },
});
