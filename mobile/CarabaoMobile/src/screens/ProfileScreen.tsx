// src/screens/ProfileScreen.tsx
import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, SafeAreaView, Alert, Switch, Image,
} from 'react-native';
import { useAuth } from '../lib/AuthContext';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';

interface SettingItemProps {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  rightElement?: React.ReactNode;
  danger?: boolean;
}

function SettingItem({ icon, label, value, onPress, rightElement, danger }: SettingItemProps) {
  return (
    <TouchableOpacity
      style={styles.settingItem}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.settingIconWrap, danger && styles.settingIconDanger]}>
        <Text style={styles.settingIcon}>{icon}</Text>
      </View>
      <View style={styles.settingInfo}>
        <Text style={[styles.settingLabel, danger && styles.settingLabelDanger]}>{label}</Text>
        {value ? <Text style={styles.settingValue}>{value}</Text> : null}
      </View>
      {rightElement ?? (onPress ? <Text style={styles.settingChevron}>›</Text> : null)}
    </TouchableOpacity>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <Text style={styles.sectionHeader}>{title}</Text>
  );
}

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [promoEnabled, setPromoEnabled] = useState(false);

  const displayName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email?.split('@')[0] || 'User'
    : 'Guest User';

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => { await signOut(); },
        },
      ]
    );
  };

  const handleMerchant = () => {
    router.push('/onboarding');
  };

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Profile Hero */}
        <View style={styles.profileHero}>
          <View style={styles.avatarWrap}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {displayName.charAt(0).toUpperCase()}
              </Text>
            </View>
            <TouchableOpacity style={styles.editAvatarBtn}>
              <Text style={styles.editAvatarIcon}>📷</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.displayName}>{displayName}</Text>
          <Text style={styles.userEmail}>{user?.email ?? 'Not signed in'}</Text>
          <TouchableOpacity style={styles.editProfileBtn}>
            <Text style={styles.editProfileText}>Edit Profile</Text>
          </TouchableOpacity>
        </View>

        {/* Become a Merchant Banner */}
        <TouchableOpacity style={styles.merchantBanner} onPress={handleMerchant} activeOpacity={0.85}>
          <View style={styles.merchantBannerLeft}>
            <Text style={styles.merchantBannerIcon}>🌾</Text>
            <View>
              <Text style={styles.merchantBannerTitle}>Become a Merchant</Text>
              <Text style={styles.merchantBannerSub}>Sell your produce on Carabao</Text>
            </View>
          </View>
          <Text style={styles.merchantBannerArrow}>→</Text>
        </TouchableOpacity>

        <View style={styles.sections}>
          {/* Account */}
          <SectionHeader title="Account" />
          <View style={styles.settingsGroup}>
            <SettingItem icon="📍" label="Saved Addresses" value="1 address saved" onPress={() => { }} />
            <SettingItem icon="💳" label="Payment Methods" value="No cards saved" onPress={() => { }} />
            <SettingItem icon="🧾" label="Order History" onPress={() => router.push('/(tabs)/history')} />
          </View>

          {/* Notifications */}
          <SectionHeader title="Notifications" />
          <View style={styles.settingsGroup}>
            <SettingItem
              icon="🔔"
              label="Order Updates"
              rightElement={
                <Switch
                  value={notifEnabled}
                  onValueChange={setNotifEnabled}
                  trackColor={{ false: Colors.border, true: Colors.primaryLight }}
                  thumbColor={notifEnabled ? Colors.primary : Colors.white}
                />
              }
            />
            <SettingItem
              icon="📣"
              label="Promotions"
              rightElement={
                <Switch
                  value={promoEnabled}
                  onValueChange={setPromoEnabled}
                  trackColor={{ false: Colors.border, true: Colors.primaryLight }}
                  thumbColor={promoEnabled ? Colors.primary : Colors.white}
                />
              }
            />
          </View>

          {/* Preferences */}
          <SectionHeader title="Preferences" />
          <View style={styles.settingsGroup}>
            <SettingItem icon="🌐" label="Language" value="English" onPress={() => { }} />
            <SettingItem icon="☀️" label="Theme" value="Light" onPress={() => { }} />
          </View>

          {/* Support */}
          <SectionHeader title="Support" />
          <View style={styles.settingsGroup}>
            <SettingItem icon="❓" label="Help Center" onPress={() => { }} />
            <SettingItem icon="📄" label="Terms & Privacy" onPress={() => { }} />
            <SettingItem icon="⭐" label="Rate the App" onPress={() => { }} />
          </View>

          {/* Sign out */}
          <View style={[styles.settingsGroup, { marginTop: Spacing.sm }]}>
            <SettingItem
              icon="🚪"
              label="Sign Out"
              onPress={handleSignOut}
              danger
            />
          </View>
        </View>

        {/* App version */}
        <Text style={styles.version}>Carabao v1.0.0  •  Made in the Philippines 🇵🇭</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  scroll: { paddingBottom: 100 },

  profileHero: {
    backgroundColor: Colors.primaryDark,
    paddingTop: Spacing.xxl, paddingBottom: 40,
    alignItems: 'center', gap: Spacing.sm,
    overflow: 'hidden',
  },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.4)',
  },
  avatarText: { fontSize: FontSize.xxxl, fontWeight: '800', color: Colors.white },
  editAvatarBtn: {
    position: 'absolute', bottom: 0, right: 0,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.primaryDark,
  },
  editAvatarIcon: { fontSize: 14 },
  displayName: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.white },
  userEmail: { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.7)' },
  editProfileBtn: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: Spacing.lg, paddingVertical: 8,
    borderRadius: Radius.full, marginTop: 4,
  },
  editProfileText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: '600' },

  merchantBanner: {
    backgroundColor: Colors.primary,
    marginHorizontal: Spacing.lg, marginTop: -20,
    borderRadius: Radius.lg, padding: Spacing.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    ...Shadow.md,
  },
  merchantBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  merchantBannerIcon: { fontSize: 28 },
  merchantBannerTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.white },
  merchantBannerSub: { fontSize: FontSize.xs, color: 'rgba(255,255,255,0.8)' },
  merchantBannerArrow: { fontSize: FontSize.xl, color: Colors.white, fontWeight: '300' },

  sections: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xl, gap: 2 },
  sectionHeader: {
    fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: '700',
    letterSpacing: 0.8, textTransform: 'uppercase',
    marginTop: Spacing.lg, marginBottom: Spacing.sm, marginLeft: 4,
  },
  settingsGroup: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', ...Shadow.sm,
  },
  settingItem: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  settingIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: Colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  settingIconDanger: { backgroundColor: Colors.errorBg },
  settingIcon: { fontSize: 18 },
  settingInfo: { flex: 1 },
  settingLabel: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  settingLabelDanger: { color: Colors.error },
  settingValue: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 1 },
  settingChevron: { fontSize: FontSize.xl, color: Colors.textLight, fontWeight: '300' },

  version: {
    textAlign: 'center', fontSize: FontSize.xs, color: Colors.textLight,
    marginTop: Spacing.xxl, marginBottom: Spacing.sm,
  },
});
