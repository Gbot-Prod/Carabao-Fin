// CF-0104: heart toggle for one produce listing. Signed-out users are sent to sign in.
import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { useSaved } from '../lib/SavedContext';
import { Colors } from '../lib/theme';

export function SaveHeart({ produceId, name, size = 22 }: { produceId: number; name: string; size?: number }) {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const { isSaved, toggle } = useSaved();
  const saved = isAuthenticated && isSaved(produceId);

  return (
    <TouchableOpacity
      style={styles.btn}
      hitSlop={8}
      onPress={() => (isAuthenticated ? void toggle(produceId) : router.push('/auth'))}
      accessibilityRole="button"
      accessibilityLabel={saved ? `Remove ${name} from saved` : `Save ${name}`}
      accessibilityState={{ selected: saved }}
    >
      <Ionicons name={saved ? 'heart' : 'heart-outline'} size={size} color={saved ? Colors.error : Colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
