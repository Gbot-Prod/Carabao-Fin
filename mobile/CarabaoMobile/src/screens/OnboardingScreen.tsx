import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../lib/AuthContext';
import { api } from '../lib/api';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { ProtectedScreen } from '../components/ProtectedScreen';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const BENEFITS: { icon: IoniconName; title: string; desc: string }[] = [
  { icon: 'cube-outline', title: 'Easy listing', desc: 'Add your produce in minutes' },
  { icon: 'cash-outline', title: 'Fast payouts', desc: 'Get paid within 24 hours of delivery' },
  { icon: 'bicycle-outline', title: 'Logistics support', desc: 'We handle delivery coordination' },
  { icon: 'bar-chart-outline', title: 'Sales analytics', desc: 'Track your performance in real-time' },
];

function OnboardingScreenContent() {
  const router = useRouter();
  const { token } = useAuth();
  const [step, setStep] = useState<'intro' | 'form'>('intro');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    farmName: '',
    location: '',
    category: '',
    description: '',
    contactInfo: '',
  });

  const handleChange = (key: string, val: string) =>
    setForm((p) => ({ ...p, [key]: val }));

  const handleSubmit = async () => {
    if (!form.farmName || !form.location || !form.category) {
      Alert.alert('Missing Fields', 'Please fill in the required fields.');
      return;
    }
    if (!token) {
      Alert.alert('Sign In Required', 'Please sign in to apply.');
      return;
    }
    setLoading(true);
    try {
      await api.merchants.apply(token, {
        merchant_name: form.farmName,
        location: form.location,
        contact_number: form.contactInfo,
      });
      Alert.alert(
        'Application Submitted',
        "Your merchant application is under review. We'll notify you within 1–2 business days.",
        [{ text: 'Done', onPress: () => router.back() }]
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to submit application';
      Alert.alert('Submission Failed', message);
    } finally {
      setLoading(false);
    }
  };

  if (step === 'intro') {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.navBar}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
          <Text style={styles.navTitle}>Become a Merchant</Text>
          <View style={{ width: 30 }} />
        </View>

        <ScrollView contentContainerStyle={styles.introScroll}>
          <View style={styles.heroBg}>
            <View style={styles.heroIconWrap}>
              <Ionicons name="storefront" size={52} color={Colors.white} />
            </View>
            <Text style={styles.heroTitle}>Sell on Carabao</Text>
            <Text style={styles.heroSub}>
              Connect with thousands of buyers across the Philippines.{'\n'}
              Fresh produce, fair prices, reliable delivery.
            </Text>
          </View>

          <View style={styles.benefitsCard}>
            <Text style={styles.benefitsTitle}>Why join us?</Text>
            {BENEFITS.map((b) => (
              <View key={b.title} style={styles.benefit}>
                <View style={styles.benefitIcon}>
                  <Ionicons name={b.icon} size={22} color={Colors.primary} />
                </View>
                <View style={styles.benefitInfo}>
                  <Text style={styles.benefitTitle}>{b.title}</Text>
                  <Text style={styles.benefitDesc}>{b.desc}</Text>
                </View>
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.ctaBtn} onPress={() => setStep('form')}>
            <Text style={styles.ctaBtnText}>Apply Now</Text>
            <Ionicons name="arrow-forward" size={18} color={Colors.white} style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => setStep('intro')}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Merchant Application</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={styles.formScroll}>
        <Text style={styles.formTitle}>Tell us about your farm</Text>
        <Text style={styles.formSub}>All fields marked * are required</Text>

        {[
          { key: 'farmName', label: 'Farm / Business Name *', placeholder: 'e.g. Dela Cruz Organic Farm' },
          { key: 'location', label: 'Location *', placeholder: 'e.g. Munoz, Nueva Ecija' },
          { key: 'category', label: 'Main Category *', placeholder: 'e.g. Vegetables, Fruits, Dairy' },
          { key: 'contactInfo', label: 'Contact Number', placeholder: 'e.g. +63 912 345 6789' },
        ].map((field) => (
          <View key={field.key} style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{field.label}</Text>
            <TextInput
              style={styles.input}
              placeholder={field.placeholder}
              placeholderTextColor={Colors.textLight}
              value={(form as Record<string, string>)[field.key]}
              onChangeText={(v) => handleChange(field.key, v)}
            />
          </View>
        ))}

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Briefly describe your farm and what makes it special..."
            placeholderTextColor={Colors.textLight}
            value={form.description}
            onChangeText={(v) => handleChange('description', v)}
            multiline
            numberOfLines={4}
          />
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, loading && styles.submitDisabled]}
          onPress={handleSubmit}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color={Colors.white} />
          ) : (
            <Text style={styles.submitText}>Submit Application</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          By applying, you agree to our Merchant Terms of Service and commit to maintaining the quality standards of the Carabao platform.
        </Text>
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

export default function OnboardingScreen() {
  return (
    <ProtectedScreen>
      <OnboardingScreenContent />
    </ProtectedScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backIcon: { fontSize: 22, color: Colors.text },
  navTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },

  introScroll: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: 40 },

  heroBg: {
    backgroundColor: Colors.primaryDark, borderRadius: Radius.lg,
    padding: Spacing.xxl, alignItems: 'center', gap: Spacing.sm,
  },
  heroIconWrap: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  heroTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.white, textAlign: 'center' },
  heroSub: { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.8)', textAlign: 'center', lineHeight: 20 },

  benefitsCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, borderWidth: 1, borderColor: Colors.border, gap: Spacing.md,
    ...Shadow.sm,
  },
  benefitsTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  benefitIcon: {
    width: 44, height: 44, borderRadius: Radius.md,
    backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  benefitInfo: { flex: 1 },
  benefitTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  benefitDesc: { fontSize: FontSize.xs, color: Colors.textMuted },

  ctaBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: 15, alignItems: 'center', ...Shadow.sm,
    flexDirection: 'row', justifyContent: 'center',
  },
  ctaBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '700' },

  formScroll: { padding: Spacing.lg, gap: Spacing.sm },
  formTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  formSub: { fontSize: FontSize.sm, color: Colors.textMuted, marginBottom: Spacing.sm },

  fieldGroup: { gap: 6 },
  fieldLabel: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textMuted },
  input: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    fontSize: FontSize.sm, color: Colors.text, backgroundColor: Colors.white,
  },
  textArea: { textAlignVertical: 'top', minHeight: 90 },

  submitBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: 15, alignItems: 'center', marginTop: Spacing.md,
    ...Shadow.sm,
  },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '700' },

  disclaimer: {
    fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center',
    lineHeight: 18, marginTop: Spacing.sm,
  },
});
