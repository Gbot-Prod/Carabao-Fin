'use client'

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './page.module.css';
import {
  createMyAddress,
  deleteMyAccount,
  deleteMyAddress,
  fetchMyAddresses,
  fetchMyProfile,
  updateMyAddress,
  updateMyProfile,
  uploadProfilePicture,
  type UserAddress,
  type UserProfile,
} from '@/util/api';
import LocationSelects from '@/components/LocationSelects/LocationSelects';
import MapPinPicker from '@/components/MapPinPicker/MapPinPicker';
import type { Pin } from '@/util/reverseGeocode';
import PageLoader from '@/components/PageLoader/PageLoader';
import TwoFactorSettings from '@/components/TwoFactorSettings/TwoFactorSettings';
import { TWO_FACTOR_ENABLED } from '@/lib/features';
import { signOut } from '@/lib/auth-client';

// Hidden for now — kept as components in ./components so they can be re-enabled:
//   PaymentPanel        (💳 Payment Methods)  <PaymentPanel userEmail={profile?.email} />
//   NotificationsPanel  (🔔 Notifications)    <NotificationsPanel profile={profile} onSaved={setProfile} />
//   SupportPanel        (💬 Contact support)  <SupportPanel />
// The "View Merchant Page" / "Merchant Dashboard" links were also removed from
// the left column; merchants reach the dashboard from the main navigation.

// ─── Helpers ──────────────────────────────────────────────────────────────────
const formatDate = (v: string | null | undefined) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
};

const formatPeso = (v: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(v);

const NoData = ({ text = 'No data' }: { text?: string }) => <em className={styles.noData}>{text}</em>;

// ─── Avatar ───────────────────────────────────────────────────────────────────
function UserAvatar({ pictureUrl, uploading, onUpload }: {
  pictureUrl: string | null;
  uploading: boolean;
  onUpload: (file: File) => void;
}) {
  return (
    <label className={styles.avatarWrap} title="Click to change photo">
      {uploading ? (
        <div className={styles.avatarPlaceholder}><span className={styles.avatarSpinner} /></div>
      ) : pictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={pictureUrl} alt="Your profile photo" className={styles.avatar} />
      ) : (
        <svg className={styles.avatar} viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="40" cy="40" r="40" fill="#d7e7da" />
          <circle cx="40" cy="30" r="14" fill="#31925d" />
          <path d="M8 76 Q8 54 40 54 Q72 54 72 76" fill="#31925d" />
        </svg>
      )}
      <div className={styles.avatarOverlay}>
        <span className={styles.avatarOverlayText}>Change</span>
      </div>
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        disabled={uploading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          e.target.value = '';
        }}
      />
    </label>
  );
}

// ─── Address panel ────────────────────────────────────────────────────────────
const MAX_ADDRESSES = 10; // matches the backend cap

type AddressForm = { label: string; address: string; barangay: string; city: string; province: string; region: string; postal_code: string };

const formFromAddress = (a: UserAddress | null): AddressForm => ({
  label: a?.label ?? '',
  address: a?.address ?? '',
  barangay: a?.barangay ?? '',
  city: a?.city ?? '',
  province: a?.province ?? '',
  region: a?.region ?? '',
  postal_code: a?.postal_code ?? '',
});

const pinFromAddress = (a: UserAddress | null): Pin | null =>
  a?.lat != null && a?.lng != null ? { lat: a.lat, lng: a.lng } : null;

const addressLine = (a: UserAddress) =>
  [a.address, a.barangay, a.city, a.province, a.postal_code].filter(Boolean).join(', ');

function AddressPanel({ addresses, onChanged }: { addresses: UserAddress[] | null; onChanged: () => Promise<void> }) {
  // null: list view; 'new': adding; a number: editing that address.
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<AddressForm>(() => formFromAddress(null));
  // Map pin for the address (U1b); null until the user drops one.
  const [pin, setPin] = useState<Pin | null>(null);

  const startEdit = (a: UserAddress | null) => {
    setError(null);
    setForm(formFromAddress(a));
    setPin(pinFromAddress(a));
    setEditing(a ? a.id : 'new');
  };
  const cancel = () => { setEditing(null); setError(null); };

  const run = async (action: () => Promise<unknown>, failMessage: string) => {
    setBusy(true); setError(null);
    try {
      await action();
      await onChanged();
      setEditing(null);
    } catch { setError(failMessage); }
    finally { setBusy(false); }
  };

  const save = () => {
    const clean = (v: string) => v.trim() || null;
    const payload = {
      label: clean(form.label),
      region: clean(form.region),
      province: clean(form.province),
      city: clean(form.city),
      barangay: clean(form.barangay),
      address: clean(form.address),
      postal_code: clean(form.postal_code),
      lat: pin?.lat ?? null,
      lng: pin?.lng ?? null,
    };
    const id = editing;
    void run(
      () => (id === 'new' || id === null ? createMyAddress(payload) : updateMyAddress(id, payload)),
      'Failed to save. Please try again.',
    );
  };

  const setField = (f: keyof AddressForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [f]: e.target.value }));

  if (!addresses) return <PageLoader variant="compact" />;

  if (editing !== null) {
    return (
      <div className={styles.panelForm}>
        <div className={styles.panelFormField}>
          <label htmlFor="profile-address-label" className={styles.formLabel}>Label</label>
          <input id="profile-address-label" className={styles.formInput} value={form.label} onChange={setField('label')} placeholder="Home, Office…" maxLength={50} />
        </div>
        <LocationSelects
          value={{ region: form.region, province: form.province, city: form.city, barangay: form.barangay }}
          onChange={(location) => setForm(prev => ({ ...prev, ...location }))}
          selectClassName={styles.formInput}
          labelClassName={styles.formLabel}
          wrapClassName={styles.panelFormField}
        />
        <div className={styles.panelFormField}>
          <label htmlFor="profile-address" className={styles.formLabel}>Street / House No.</label>
          <input id="profile-address" className={styles.formInput} value={form.address} onChange={setField('address')} placeholder="123 Rizal Ave, Unit 4B" />
        </div>
        <div className={styles.panelFormField}>
          <label htmlFor="profile-postal-code" className={styles.formLabel}>Postal code</label>
          <input id="profile-postal-code" className={styles.formInput} value={form.postal_code} onChange={setField('postal_code')} placeholder="1634" />
        </div>
        <div className={styles.panelFormField}>
          <MapPinPicker
            value={pin}
            onChange={(next, found) => {
              setPin(next);
              // Fill what the pin tells us; keep anything the user already typed.
              setForm(prev => ({
                ...prev,
                address: prev.address || found?.street || '',
                postal_code: prev.postal_code || found?.postcode || '',
              }));
            }}
          />
        </div>
        {error && <p className={styles.panelError}>{error}</p>}
        <div className={styles.panelActions}>
          <button className={styles.saveBtn} onClick={save} disabled={busy} type="button">{busy ? 'Saving…' : 'Save'}</button>
          <button className={styles.cancelBtn} onClick={cancel} disabled={busy} type="button">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panelView}>
      {addresses.length === 0 && <NoData text="No saved addresses yet" />}
      {addresses.map((a) => {
        const savedPin = pinFromAddress(a);
        return (
          <div key={a.id} className={styles.addressCard}>
            <div className={styles.addressHead}>
              <strong>{a.label || 'Address'}</strong>
              {a.is_default && <span className={styles.defaultBadge}>Default</span>}
            </div>
            <span className={styles.panelRowValue}>{addressLine(a) || <NoData />}</span>
            <span className={styles.panelRowValue}>
              {savedPin ? `Pin: ${savedPin.lat.toFixed(5)}, ${savedPin.lng.toFixed(5)}` : <NoData text="Not pinned" />}
            </span>
            <div className={styles.addressActions}>
              <button className={styles.linkBtn} onClick={() => startEdit(a)} disabled={busy} type="button">Edit</button>
              {!a.is_default && (
                <button
                  className={styles.linkBtn}
                  onClick={() => void run(() => updateMyAddress(a.id, { is_default: true }), 'Could not change the default address.')}
                  disabled={busy}
                  type="button"
                >
                  Make default
                </button>
              )}
              <button
                className={`${styles.linkBtn} ${styles.linkBtnDanger}`}
                onClick={() => void run(() => deleteMyAddress(a.id), 'Could not delete the address.')}
                disabled={busy}
                type="button"
              >
                Delete
              </button>
            </div>
          </div>
        );
      })}
      {error && <p className={styles.panelError}>{error}</p>}
      {addresses.length < MAX_ADDRESSES && (
        <button className={styles.panelEditBtn} onClick={() => startEdit(null)} disabled={busy} type="button">+ Add address</button>
      )}
    </div>
  );
}

// ─── Edit profile form ────────────────────────────────────────────────────────
type EditForm = { name: string; phone_number: string };

const profileToForm = (p: UserProfile): EditForm =>
  ({ name: p.name ?? '', phone_number: p.phone_number ?? '' });

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Profile() {
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<EditForm>({ name: '', phone_number: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    fetchMyProfile()
      .then(data => { setProfile(data); setForm(profileToForm(data)); })
      .catch(() => setLoadError('Could not load profile. Please refresh.'))
      .finally(() => setIsLoading(false));
  }, []);

  const handleAvatarUpload = async (file: File) => {
    setAvatarUploading(true);
    try {
      setProfile(await uploadProfilePicture(file));
    } catch {
      // silently fail — avatar stays as-is
    } finally {
      setAvatarUploading(false);
    }
  };

  const openModal = () => { if (profile) setForm(profileToForm(profile)); setSaveError(null); setModalOpen(true); };
  const closeModal = () => { setSaveError(null); setModalOpen(false); };

  const handleSave = async () => {
    setIsSaving(true); setSaveError(null);
    try {
      const updated = await updateMyProfile({
        name: form.name.trim().replace(/\s+/g, ' ') || null,
        phone_number: form.phone_number.trim() || null,
      });
      setProfile(updated);
      setModalOpen(false);
    } catch { setSaveError('Failed to save. Please try again.'); }
    finally { setIsSaving(false); }
  };

  const set = (field: keyof EditForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [field]: e.target.value }));

  const handleDeleteAccount = async () => {
    setDeletingAccount(true);
    try {
      await deleteMyAccount();
      await signOut().catch(() => {});
      window.location.href = '/auth';
    } catch {
      setDeletingAccount(false);
      setConfirmDeleteAccount(false);
    }
  };

  const fullName = profile ? profile.name?.trim() || 'Carabao User' : null;
  const hasMerchant = !!profile?.merchant?.id;
  const cart = profile?.cart;

  if (isLoading) return <PageLoader label="Loading your profile…" />;

  return (
    <div className={styles.container}>
      <main className={styles.main}>

        {/* ── Left column ── */}
        <div className={styles.leftCol}>
          <section className={styles.profileSection}>
            <UserAvatar
              pictureUrl={profile?.profile_picture_url ?? null}
              uploading={avatarUploading}
              onUpload={(file) => void handleAvatarUpload(file)}
            />

            <div className={styles.nameBlock}>
              <h2 className={styles.name}>{fullName ?? '—'}</h2>
              <p className={styles.email}>{profile?.email ?? '—'}</p>
            </div>

            <div className={styles.metaBlock}>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Phone</span>
                <span className={styles.metaValue}>{profile?.phone_number ?? 'No data'}</span>
              </div>
            </div>

            {loadError && <p className={styles.errorBanner}>{loadError}</p>}

            <button className={styles.editBtn} onClick={openModal} disabled={!!loadError} type="button">
              Edit Profile
            </button>

            <div className={styles.profileSnapshot}>
              <div className={styles.snapshotCard}>
                <span className={styles.snapshotLabel}>Member since</span>
                <strong className={styles.snapshotValue}>{formatDate(profile?.created_at) ?? 'No data'}</strong>
              </div>
              <div className={styles.snapshotCard}>
                <span className={styles.snapshotLabel}>Merchant</span>
                <strong className={styles.snapshotValue}>{profile?.merchant?.merchant_name ?? 'None'}</strong>
              </div>
              <div className={`${styles.snapshotCard} ${styles.snapshotCardWide}`}>
                <span className={styles.snapshotLabel}>Cart</span>
                <strong className={styles.snapshotValue}>
                  {cart ? `${cart.total_items} item${cart.total_items === 1 ? '' : 's'} · ${formatPeso(cart.total_price)}` : 'No data'}
                </strong>
              </div>
            </div>
          </section>

          {/* Non-merchants get an entry point to onboarding */}
          {!hasMerchant && (
            <section className={styles.merchantSection}>
              <Link className={`${styles.merchantBtn} ${styles.merchantBtnPrimary}`} href="/merchantOnboarding">
                Apply as Merchant
              </Link>
            </section>
          )}

          {/* Two-step verification (E8a): admins only */}
          {TWO_FACTOR_ENABLED && profile?.is_admin && <TwoFactorSettings />}

          {/* Help & Support: FAQ, contact, Terms, Privacy (app/(app)/help) */}
          <section className={styles.merchantSection}>
            <Link className={styles.merchantBtn} href="/help">❓ Help &amp; Support</Link>
          </section>

          <section className={styles.profileDangerZone}>
            <p className={styles.profileDangerLabel}>Danger Zone</p>
            {!confirmDeleteAccount ? (
              <button className={styles.profileDangerBtn} onClick={() => setConfirmDeleteAccount(true)} type="button">
                Delete account
              </button>
            ) : (
              <div className={styles.profileDangerConfirm}>
                <p className={styles.profileDangerWarning}>
                  This permanently deletes your account and all data. This cannot be undone.
                </p>
                <button
                  className={styles.profileDangerConfirmBtn}
                  disabled={deletingAccount}
                  onClick={() => void handleDeleteAccount()}
                  type="button"
                >
                  {deletingAccount ? 'Deleting…' : 'Yes, delete my account'}
                </button>
                <button
                  className={styles.merchantBtn}
                  disabled={deletingAccount}
                  onClick={() => setConfirmDeleteAccount(false)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            )}
          </section>
        </div>

        {/* ── Right column: Account Settings ── */}
        <section className={styles.settingsSection}>
          <h3 className={styles.settingsTitle}>Account Settings</h3>
          <div className={styles.settingsList}>
            <div className={styles.settingCard}>
              <div className={styles.settingHeader}>
                <span className={styles.settingLabel}>📍 Addresses</span>
              </div>
              <div className={styles.settingDetails}>
                <AddressPanel
                  addresses={profile?.addresses ?? null}
                  onChanged={async () => {
                    const addresses = await fetchMyAddresses();
                    setProfile(p => (p ? { ...p, addresses } : p));
                  }}
                />
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── Edit profile modal ── */}
      {modalOpen && (
        <div className={styles.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Edit Profile</h3>
            <div className={styles.formGrid}>
              <div className={`${styles.formGroup} ${styles.formGroupFull}`}>
                <label htmlFor="profile-name" className={styles.formLabel}>Full name</label>
                <input id="profile-name" className={styles.formInput} value={form.name} onChange={set('name')} placeholder="Juan dela Cruz" autoComplete="name" />
              </div>
              <div className={`${styles.formGroup} ${styles.formGroupFull}`}>
                <label htmlFor="profile-phone-number" className={styles.formLabel}>Phone number</label>
                <div className={styles.phoneRow}>
                  <span className={styles.phonePrefix}>+63</span>
                  <input id="profile-phone-number" className={`${styles.formInput} ${styles.phoneInput}`} value={form.phone_number} onChange={set('phone_number')} placeholder="912 345 6789" />
                </div>
              </div>
            </div>
            {saveError && <p className={styles.saveError}>{saveError}</p>}
            <div className={styles.modalActions}>
              <button className={styles.saveBtn} onClick={handleSave} disabled={isSaving} type="button">{isSaving ? 'Saving…' : 'Save changes'}</button>
              <button className={styles.cancelBtn} onClick={closeModal} disabled={isSaving} type="button">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
