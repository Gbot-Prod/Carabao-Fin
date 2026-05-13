import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../lib/AuthContext';
import { Colors, FontSize, Spacing } from '../lib/theme';

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
  const { isAuthenticated, user, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // If authentication state changes and user is no longer authenticated,
    // clear the screen and sign out
    if (!isAuthenticated) {
      handleUnauthorized();
    }
  }, [isAuthenticated]);

  const handleUnauthorized = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const handleSignIn = () => {
    router.replace('/auth');
  };

  if (!isAuthenticated) {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <View style={styles.iconContainer}>
            <Ionicons name="alert-circle-outline" size={56} color="#F59E0B" />
          </View>
          <Text style={styles.title}>Session Expired</Text>
          <Text style={styles.message}>
            Your login session has expired. Please sign in again to continue.
          </Text>
          <TouchableOpacity style={styles.button} onPress={handleSignIn}>
            <Ionicons name="log-in-outline" size={20} color={Colors.white} style={{ marginRight: 8 }} />
            <Text style={styles.buttonText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Role-based access control (can be extended in the future)
  if (requiredRole && user?.role !== requiredRole) {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <View style={styles.iconContainer}>
            <Ionicons name="lock-closed-outline" size={56} color="#EF4444" />
          </View>
          <Text style={styles.title}>Access Denied</Text>
          <Text style={styles.message}>
            You don't have permission to access this page.
          </Text>
        </View>
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    backgroundColor: '#F9FAFB',
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  iconContainer: {
    marginBottom: Spacing.lg,
  },
  title: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.md,
    textAlign: 'center',
  },
  message: {
    fontSize: FontSize.md,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },
  button: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 160,
  },
  buttonText: {
    color: Colors.white,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
});
