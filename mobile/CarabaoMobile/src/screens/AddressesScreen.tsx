// src/screens/AddressesScreen.tsx
// CF-0110: the buyer's saved delivery addresses (web profile address book):
// add, edit, make default, delete. Checkout starts with the default one.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, SafeAreaView, Alert, Modal,
  KeyboardAvoidingView, Platform, ScrollView, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { api, type ApiUserAddress } from '../lib/api';
import { ADDRESS_LIMITS, addressLine, checkAddress, type AddressFields } from '../lib/addresses';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { Button, Badge } from '../components/UI';
import { ProtectedScreen } from '../components/ProtectedScreen';
import { SkeletonList, LoadError } from '../components/Skeleton';

const EMPTY: AddressFields = { label: '', address: '', barangay: '', city: '', province: '', postal_code: '' };
const FIELDS: { key: keyof AddressFields; label: string; placeholder: string; keyboard?: 'number-pad' }[] = [
  { key: 'label', label: 'Label (optional)', placeholder: 'Home, Office…' },
  { key: 'address', label: 'House number and street', placeholder: '12 Rizal St' },
  { key: 'barangay', label: 'Barangay', placeholder: 'San Roque' },
  { key: 'city', label: 'City / municipality', placeholder: 'Marikina' },
  { key: 'province', label: 'Province', placeholder: 'Metro Manila' },
  { key: 'postal_code', label: 'Postal code (optional)', placeholder: '1800', keyboard: 'number-pad' },
];

function fieldsOf(a: ApiUserAddress | null): AddressFields {
  if (!a) return EMPTY;
  return {
    label: a.label ?? '', address: a.address ?? '', barangay: a.barangay ?? '',
    city: a.city ?? '', province: a.province ?? '', postal_code: a.postal_code ?? '',
  };
}

type Load = { kind: 'ok'; list: ApiUserAddress[] } | { kind: 'error'; message: string };
const fetchList = (token: string | null): Promise<Load> =>
  api.addresses
    .list(token)
    .then((list): Load => ({ kind: 'ok', list }))
    .catch((err: unknown): Load => ({ kind: 'error', message: err instanceof Error ? err.message : 'Could not load addresses' }));

function AddressesContent() {
  const router = useRouter();
  const { token } = useAuth();
  const [load, setLoad] = useState<Load | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // null = closed, 'new' = add form, otherwise the address being edited.
  const [editing, setEditing] = useState<ApiUserAddress | 'new' | null>(null);
  const [form, setForm] = useState<AddressFields>(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchList(token).then((r) => { if (active) setLoad(r); });
    return () => { active = false; };
  }, [token]);

  const reload = useCallback(async () => setLoad(await fetchList(token)), [token]);

  const open = (a: ApiUserAddress | 'new') => {
    setForm(fieldsOf(a === 'new' ? null : a));
    setFormError(null);
    setEditing(a);
  };

  const save = async () => {
    const r = checkAddress(form);
    if ('error' in r) return setFormError(r.error);
    setSaving(true);
    try {
      if (editing === 'new') await api.addresses.create(token, r.ok);
      else if (editing) await api.addresses.update(token, editing.id, r.ok);
      setEditing(null);
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save this address');
    } finally {
      setSaving(false);
    }
  };

  const act = async (call: () => Promise<unknown>, failTitle: string) => {
    try {
      await call();
    } catch (err) {
      Alert.alert(failTitle, err instanceof Error ? err.message : 'Please try again.');
    }
    await reload();
  };

  const remove = (a: ApiUserAddress) =>
    Alert.alert('Delete address?', addressLine(a), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void act(() => api.addresses.remove(token, a.id), 'Not deleted') },
    ]);

  let body: React.ReactNode;
  if (load === null) body = <SkeletonList label="Loading addresses" rows={2} />;
  else if (load.kind === 'error') body = <LoadError message={load.message} onRetry={() => { setLoad(null); void reload(); }} />;
  else {
    body = (
      <FlatList
        data={load.list}
        keyExtractor={(a) => String(a.id)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }} />
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.cardLabel}>{item.label || 'Address'}</Text>
              {item.is_default ? <Badge label="Default" color="green" /> : null}
            </View>
            <Text style={styles.cardLine}>{addressLine(item)}</Text>
            <View style={styles.cardActions}>
              <TouchableOpacity style={styles.linkBtn} onPress={() => open(item)}>
                <Text style={styles.linkText}>Edit</Text>
              </TouchableOpacity>
              {!item.is_default && (
                <TouchableOpacity
                  style={styles.linkBtn}
                  onPress={() => void act(() => api.addresses.update(token, item.id, { is_default: true }), 'Not changed')}
                >
                  <Text style={styles.linkText}>Make default</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.linkBtn} onPress={() => remove(item)}>
                <Text style={[styles.linkText, { color: Colors.error }]}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="location-outline" size={44} color={Colors.textLight} />
            <Text style={styles.emptyTitle}>No saved addresses</Text>
            <Text style={styles.emptySub}>Save one to fill in checkout faster. Carabao delivers within Luzon.</Text>
          </View>
        }
        ListFooterComponent={<Button label="Add address" onPress={() => open('new')} fullWidth style={{ marginTop: Spacing.md }} />}
      />
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Addresses</Text>
      </View>
      {body}

      <Modal visible={editing !== null} animationType="slide" transparent onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>{editing === 'new' ? 'New address' : 'Edit address'}</Text>
              {FIELDS.map((f) => (
                <View key={f.key}>
                  <Text style={styles.label}>{f.label}</Text>
                  <TextInput
                    style={styles.input}
                    value={form[f.key]}
                    onChangeText={(v) => setForm((p) => ({ ...p, [f.key]: v }))}
                    placeholder={f.placeholder}
                    placeholderTextColor={Colors.textLight}
                    maxLength={ADDRESS_LIMITS[f.key]}
                    keyboardType={f.keyboard ?? 'default'}
                    accessibilityLabel={f.label}
                  />
                </View>
              ))}
              {formError ? <Text style={styles.error}>{formError}</Text> : null}
              <View style={styles.sheetActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(null)} disabled={saving}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <Button label="Save" onPress={save} loading={saving} style={{ flex: 1 }} />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

export default function AddressesScreen() {
  return (
    <ProtectedScreen>
      <AddressesContent />
    </ProtectedScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  list: { padding: Spacing.lg, gap: Spacing.sm },
  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.xs,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.sm,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardLabel: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  cardLine: { fontSize: FontSize.sm, color: Colors.textMuted, lineHeight: 20 },
  cardActions: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.xs },
  linkBtn: { minHeight: 44, justifyContent: 'center' },
  linkText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  empty: { alignItems: 'center', paddingTop: 40, gap: Spacing.sm },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  emptySub: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: Colors.white, padding: Spacing.lg, maxHeight: '90%',
    borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
  },
  sheetTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text, marginBottom: Spacing.sm },
  label: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600', marginBottom: 6, marginTop: Spacing.md },
  input: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: Spacing.md,
    paddingVertical: 11, fontSize: FontSize.sm, color: Colors.text, backgroundColor: Colors.surfaceAlt,
  },
  error: { color: Colors.error, fontSize: FontSize.sm, marginTop: Spacing.md },
  sheetActions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xl, alignItems: 'center' },
  cancelBtn: { flex: 1, paddingVertical: 13, alignItems: 'center', borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border },
  cancelText: { fontSize: FontSize.md, color: Colors.textMuted, fontWeight: '600' },
});
