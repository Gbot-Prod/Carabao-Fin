// src/screens/MoreScreen.tsx
// The More tab (plan §4.4). Small on purpose: the farm name at the top plus the rows
// that do not need a tab. S8 adds the verification banner here (`verificationBanner`
// from `dashboard.ts`); until then the name comes from the gate's /users/me profile,
// which the root gate already loaded once the tabs are reachable.
import React, { useState } from 'react';
import {
  ActivityIndicator, Alert, Linking, SafeAreaView, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '../lib/AuthContext';
import { useMerchantGate } from '../lib/MerchantContext';
import { WEB_BASE } from '../lib/api';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../lib/theme';

// The buyer app's scheme (README). If it is not installed the website opens instead.
const BUYER_APP_URL = 'carabaomobile://';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface RowProps {
  icon: IoniconName;
  label: string;
  value?: string;
  right?: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}

function Row({ icon, label, value, right, onPress, disabled, danger }: RowProps) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
    >
      <View style={[styles.rowIcon, danger && styles.rowIconDanger]}>
        <Ionicons name={icon} size={18} color={danger ? Colors.error : Colors.textMuted} />
      </View>
      <View style={styles.rowInfo}>
        <Text style={[styles.rowLabel, danger && styles.rowLabelDanger]}>{label}</Text>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      </View>
      {right ?? <Ionicons name="chevron-forward" size={16} color={Colors.textLight} />}
    </TouchableOpacity>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

export default function MoreScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const { profile } = useMerchantGate();
  const [signingOut, setSigningOut] = useState(false);

  const farmName = profile?.merchant?.merchant_name ?? 'Your farm';
  const account = profile?.name || profile?.email || profile?.phone_number || '';

  const openBuyerApp = async () => {
    try {
      if (await Linking.canOpenURL(BUYER_APP_URL)) {
        await Linking.openURL(BUYER_APP_URL);
        return;
      }
      // Not installed, or the platform refuses to answer the query: use the website.
      await WebBrowser.openBrowserAsync(WEB_BASE);
    } catch {
      Alert.alert('Could not open the buyer app', 'Please try again later.');
    }
  };

  const openMerchantCentre = () => {
    // /merchantDashboard redirects to the merchant host when the web uses subdomains.
    void WebBrowser.openBrowserAsync(`${WEB_BASE}/merchantDashboard`).catch(() => {
      Alert.alert('Could not open the page', 'Please try again later.');
    });
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          setSigningOut(true);
          try {
            // The root gate then offers only /auth, so the app lands on sign-in (plan §4.3).
            await signOut();
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="storefront" size={26} color={Colors.white} />
          </View>
          <View style={styles.heroText}>
            <Text style={styles.farmName} numberOfLines={1}>{farmName}</Text>
            {account ? <Text style={styles.account} numberOfLines={1}>{account}</Text> : null}
          </View>
        </View>

        {/* S8 adds the verification banner here (verificationBanner from dashboard.ts). */}

        <SectionHeader title="Farm" />
        <View style={styles.group}>
          <Row icon="star-outline" label="Reviews" onPress={() => router.push('/reviews')} />
          <Row icon="notifications-outline" label="Notifications" onPress={() => router.push('/notifications')} />
        </View>

        <SectionHeader title="Carabao" />
        <View style={styles.group}>
          <Row
            icon="phone-portrait-outline"
            label="Open buyer app"
            value="Shop on Carabao as a buyer"
            onPress={() => void openBuyerApp()}
          />
          <Row
            icon="globe-outline"
            label="Merchant Centre on the web"
            value={WEB_BASE}
            onPress={openMerchantCentre}
          />
        </View>

        <View style={[styles.group, styles.signOutGroup]}>
          <Row
            icon="log-out-outline"
            label="Sign out"
            danger
            disabled={signingOut}
            right={signingOut ? <ActivityIndicator size="small" color={Colors.textMuted} /> : undefined}
            onPress={handleSignOut}
          />
        </View>

        <Text style={styles.version}>Carabao Merchant v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxl },

  hero: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.primaryDark, borderRadius: Radius.lg,
    padding: Spacing.lg, ...Shadow.md,
  },
  heroIcon: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  heroText: { flex: 1 },
  farmName: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.white },
  account: { fontSize: FontSize.xs, color: 'rgba(255,255,255,0.75)', marginTop: 2 },

  sectionHeader: {
    fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: '700',
    letterSpacing: 0.8, textTransform: 'uppercase',
    marginTop: Spacing.lg, marginBottom: Spacing.sm, marginLeft: 4,
  },
  group: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', ...Shadow.sm,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  rowIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: Colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  rowIconDanger: { backgroundColor: Colors.errorBg },
  rowInfo: { flex: 1 },
  rowLabel: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  rowLabelDanger: { color: Colors.error },
  rowValue: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 1 },
  signOutGroup: { marginTop: Spacing.lg },

  version: {
    textAlign: 'center', fontSize: FontSize.xs, color: Colors.textLight,
    marginTop: Spacing.xl,
  },
});
