// src/screens/ProfileScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, SafeAreaView, Alert, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../lib/AuthContext';
import { useRouter } from 'expo-router';
import { api, type ApiUserProfile } from '../lib/api';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { ProtectedScreen } from '../components/ProtectedScreen';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface SettingItemProps {
  icon: IoniconName;
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
        <Ionicons name={icon} size={18} color={danger ? Colors.error : Colors.textMuted} />
      </View>
      <View style={styles.settingInfo}>
        <Text style={[styles.settingLabel, danger && styles.settingLabelDanger]}>{label}</Text>
        {value ? <Text style={styles.settingValue}>{value}</Text> : null}
      </View>
      {rightElement ?? (onPress ? <Ionicons name="chevron-forward" size={16} color={Colors.textLight} /> : null)}
    </TouchableOpacity>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <Text style={styles.sectionHeader}>{title}</Text>
  );
}

function ProfileScreenContent() {
  const { user, token, signOut } = useAuth();
  const router = useRouter();
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [promoEnabled, setPromoEnabled] = useState(false);
  const [profile, setProfile] = useState<ApiUserProfile | null>(null);

  useEffect(() => {
    if (!token) return;
    void api.users.me(token).then(setProfile).catch(() => { });
  }, [token]);

  const firstName = profile?.first_name ?? user?.firstName ?? '';
  const lastName = profile?.last_name ?? user?.lastName ?? '';
  const email = profile?.email ?? user?.email ?? '';
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || email.split('@')[0] || 'User';
  const phone = profile?.phone_number;
  const address = [profile?.address, profile?.city, profile?.country].filter(Boolean).join(', ');
  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'long' })
    : null;

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await signOut();
            router.replace('/auth');
          },
        },
      ]
    );
  };

  const isMerchant = !!profile?.merchant;

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
              <Ionicons name="camera" size={14} color={Colors.primaryDark} />
            </TouchableOpacity>
          </View>
          <Text style={styles.displayName}>{displayName}</Text>
          <Text style={styles.userEmail}>{email || 'Not signed in'}</Text>
          <TouchableOpacity style={styles.editProfileBtn}>
            <Text style={styles.editProfileText}>Edit Profile</Text>
          </TouchableOpacity>
        </View>

        {/* Merchant Banner */}
        <TouchableOpacity
          style={[styles.merchantBanner, isMerchant && styles.merchantBannerActive]}
          onPress={isMerchant ? undefined : handleMerchant}
          activeOpacity={isMerchant ? 1 : 0.85}
        >
          <View style={styles.merchantBannerLeft}>
            <Ionicons name={isMerchant ? 'storefront' : 'leaf'} size={28} color={Colors.white} />
            <View>
              <Text style={styles.merchantBannerTitle}>
                {isMerchant ? profile!.merchant!.merchant_name : 'Become a Merchant'}
              </Text>
              <Text style={styles.merchantBannerSub}>
                {isMerchant ? 'Manage your store on the web app' : 'Sell your produce on Carabao'}
              </Text>
            </View>
          </View>
          {!isMerchant && <Ionicons name="arrow-forward" size={20} color={Colors.white} />}
        </TouchableOpacity>

        <View style={styles.sections}>
          {/* Account */}
          <SectionHeader title="Account" />
          <View style={styles.settingsGroup}>
            <SettingItem icon="mail-outline" label="Email" value={email || 'Not set'} />
            <SettingItem icon="call-outline" label="Phone" value={phone ?? 'Not set'} onPress={() => { }} />
            <SettingItem icon="location-outline" label="Address" value={address || 'Not set'} onPress={() => { }} />
            <SettingItem icon="card-outline" label="Payment Methods" value="No cards saved" onPress={() => { }} />
            <SettingItem icon="receipt-outline" label="Order History" onPress={() => router.push('/(tabs)/history')} />
            {memberSince ? <SettingItem icon="calendar-outline" label="Member Since" value={memberSince} /> : null}
          </View>

          {/* Notifications */}
          <SectionHeader title="Notifications" />
          <View style={styles.settingsGroup}>
            <SettingItem
              icon="notifications-outline"
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
              icon="megaphone-outline"
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
            <SettingItem icon="language-outline" label="Language" value="English" onPress={() => { }} />
            <SettingItem icon="sunny-outline" label="Theme" value="Light" onPress={() => { }} />
          </View>

          {/* Support */}
          <SectionHeader title="Support" />
          <View style={styles.settingsGroup}>
            <SettingItem icon="help-circle-outline" label="Help Center" onPress={() => { }} />
            <SettingItem icon="document-text-outline" label="Terms & Privacy" onPress={() => { }} />
            <SettingItem icon="star-outline" label="Rate the App" onPress={() => { }} />
          </View>

          {/* Sign out */}
          <View style={[styles.settingsGroup, { marginTop: Spacing.sm }]}>
            <SettingItem
              icon="log-out-outline"
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

export default function ProfileScreen() {
  return (
    <ProtectedScreen>
      <ProfileScreenContent />
    </ProtectedScreen>
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
  merchantBannerActive: { backgroundColor: Colors.primaryDark },
  merchantBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  merchantBannerTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.white },
  merchantBannerSub: { fontSize: FontSize.xs, color: 'rgba(255,255,255,0.8)' },

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
  settingInfo: { flex: 1 },
  settingLabel: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  settingLabelDanger: { color: Colors.error },
  settingValue: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 1 },

  version: {
    textAlign: 'center', fontSize: FontSize.xs, color: Colors.textLight,
    marginTop: Spacing.xxl, marginBottom: Spacing.sm,
  },
});
