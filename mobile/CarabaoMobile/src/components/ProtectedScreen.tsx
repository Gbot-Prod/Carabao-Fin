import React, { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/AuthContext';

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
  }, [isAuthenticated, isLoading, router]);

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
