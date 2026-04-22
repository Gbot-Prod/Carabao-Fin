'use client'

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './page.module.css';
import { fetchMyProfile, updateMyProfile, type UserProfile } from '@/util/api';

// ─── Inline SVG avatar ────────────────────────────────────────────────────────
function UserAvatar() {
  return (
    <svg className={styles.avatar} viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="40" cy="40" r="40" fill="#d7e7da" />
      <circle cx="40" cy="30" r="14" fill="#31925d" />
      <path d="M8 76 Q8 54 40 54 Q72 54 72 76" fill="#31925d" />
    </svg>
  );
}

// ─── Settings accordion data ──────────────────────────────────────────────────
type SettingId = 'addresses' | 'payment' | 'notifications' | 'preferences';
const SETTINGS = [
  { id: 'addresses' as SettingId, label: 'Addresses', icon: '📍', details: ['Primary Address: 123 Mango Ave, Barangay Greenfields', 'Secondary Address: Add another saved address', 'Delivery Notes: Add house instructions placeholder'] },
  { id: 'payment' as SettingId, label: 'Payment Methods', icon: '💳', details: ['Saved Cards: No cards added yet', 'E-Wallet: Link your preferred wallet', 'Default Method: Select your checkout default'] },
  { id: 'notifications' as SettingId, label: 'Notifications', icon: '🔔', details: ['Order Updates: Receive status changes', 'Promotions: Weekly deals and updates', 'Email Alerts: Transaction receipt preferences'] },
  { id: 'preferences' as SettingId, label: 'Preferences', icon: '⚙️', details: ['Language: English', 'Theme: Light mode default', 'App Experience: Personalized recommendations'] },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const formatDate = (v: string | null | undefined) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
};

const formatPeso = (v: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(v);

type EditForm = { first_name: string; last_name: string; phone_number: string; address: string; city: string; country: string; postal_code: string };

function profileToForm(p: UserProfile): EditForm {
  return { first_name: p.first_name ?? '', last_name: p.last_name ?? '', phone_number: p.phone_number ?? '', address: p.address ?? '', city: p.city ?? '', country: p.country ?? '', postal_code: p.postal_code ?? '' };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Profile() {
  const [openId, setOpenId] = useState<SettingId | null>('addresses');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<EditForm>({ first_name: '', last_name: '', phone_number: '', address: '', city: '', country: '', postal_code: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const data = await fetchMyProfile();
        setProfile(data);
        setForm(profileToForm(data));
      } catch {
        setLoadError('Could not load profile. Please refresh.');
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, []);

  const openModal = () => {
    if (profile) setForm(profileToForm(profile));
    setSaveError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setSaveError(null);
    setModalOpen(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const updated = await updateMyProfile({
        first_name: form.first_name.trim() || null,
        last_name: form.last_name.trim() || null,
        phone_number: form.phone_number.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        country: form.country.trim() || null,
        postal_code: form.postal_code.trim() || null,
      });
      setProfile(updated);
      setModalOpen(false);
    } catch {
      setSaveError('Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const set = (field: keyof EditForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  // Derived display values
  const fullName = profile ? [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim() || 'Carabao User' : null;
  const addressLine = profile ? [profile.address, profile.city, profile.country, profile.postal_code].filter(Boolean).join(', ') : null;
  const merchantHref = profile?.merchant?.id ? `/merchant/${profile.merchant.id}` : '/merchantOnboarding';
  const merchantLabel = profile?.merchant?.id ? 'View Merchant Page' : 'Apply as Merchant';

  return (
    <div className={styles.container}>
      <main className={styles.main}>

        {/* ── Left: Profile card ── */}
        <section className={styles.profileSection}>

          {/* Avatar — always same size */}
          <div className={styles.avatarWrap}>
            <UserAvatar />
          </div>

          {/* Name + email block — always same height */}
          <div className={styles.nameBlock}>
            <h2 className={styles.name}>{isLoading ? '—' : (fullName ?? '—')}</h2>
            <p className={styles.email}>{isLoading ? '—' : (profile?.email ?? '—')}</p>
          </div>

          {/* Meta lines — always same rows */}
          <div className={styles.metaBlock}>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Phone</span>
              <span className={styles.metaValue}>{isLoading ? '—' : (profile?.phone_number ?? 'No data')}</span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Address</span>
              <span className={styles.metaValue}>{isLoading ? '—' : (addressLine ?? 'No data')}</span>
            </div>
          </div>

          {loadError && <p className={styles.errorBanner}>{loadError}</p>}

          {/* Edit button — always in same place */}
          <button
            className={styles.editBtn}
            onClick={openModal}
            disabled={isLoading || !!loadError}
            type="button"
          >
            Edit Profile
          </button>

          {/* Snapshot cards — always 4, fixed grid */}
          <div className={styles.profileSnapshot}>
            <div className={styles.snapshotCard}>
              <span className={styles.snapshotLabel}>Member since</span>
              <strong className={styles.snapshotValue}>{isLoading ? '—' : (formatDate(profile?.created_at) ?? 'No data')}</strong>
            </div>
            <div className={styles.snapshotCard}>
              <span className={styles.snapshotLabel}>Merchant</span>
              <strong className={styles.snapshotValue}>{isLoading ? '—' : (profile?.merchant?.merchant_name ?? 'No data')}</strong>
            </div>
            <div className={styles.snapshotCard}>
              <span className={styles.snapshotLabel}>Cart</span>
              <strong className={styles.snapshotValue}>
                {isLoading ? '—' : profile?.cart ? `${profile.cart.total_items} item${profile.cart.total_items === 1 ? '' : 's'} · ${formatPeso(profile.cart.total_price)}` : 'No data'}
              </strong>
            </div>
            <div className={styles.snapshotCard}>
              <span className={styles.snapshotLabel}>Auth link</span>
              <strong className={styles.snapshotValue}>{isLoading ? '—' : (profile?.external_auth_id ?? 'No data')}</strong>
            </div>
          </div>
        </section>

        {/* ── Right: Account Settings ── */}
        <section className={styles.settingsSection}>
          <h3 className={styles.settingsTitle}>Account Settings</h3>
          <div className={styles.settingsList}>
            {SETTINGS.map(({ id, label, icon, details }) => {
              const isOpen = openId === id;
              return (
                <div key={id} className={styles.settingCard}>
                  <button className={styles.settingItem} onClick={() => setOpenId(isOpen ? null : id)} type="button" aria-expanded={isOpen} aria-controls={`${id}-panel`}>
                    <span className={styles.settingLabel}>{icon} {label}</span>
                    <span className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`}>⌄</span>
                  </button>
                  {isOpen && (
                    <div id={`${id}-panel`} className={styles.settingDetails}>
                      {details.map((d) => <div key={d} className={styles.placeholderDetail}>{d}</div>)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </main>

      <Link className={styles.merchantButton} href={merchantHref}>{merchantLabel}</Link>

      {/* ── Edit modal — overlaid, never shifts layout ── */}
      {modalOpen && (
        <div className={styles.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Edit Profile</h3>

            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>First name</label>
                <input className={styles.formInput} value={form.first_name} onChange={set('first_name')} placeholder="First name" />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Last name</label>
                <input className={styles.formInput} value={form.last_name} onChange={set('last_name')} placeholder="Last name" />
              </div>
              <div className={`${styles.formGroup} ${styles.formGroupFull}`}>
                <label className={styles.formLabel}>Phone number</label>
                <input className={styles.formInput} value={form.phone_number} onChange={set('phone_number')} placeholder="+63 912 345 6789" />
              </div>
              <div className={`${styles.formGroup} ${styles.formGroupFull}`}>
                <label className={styles.formLabel}>Street address</label>
                <input className={styles.formInput} value={form.address} onChange={set('address')} placeholder="123 Rizal Ave" />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>City</label>
                <input className={styles.formInput} value={form.city} onChange={set('city')} placeholder="Taguig" />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Country</label>
                <input className={styles.formInput} value={form.country} onChange={set('country')} placeholder="Philippines" />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Postal code</label>
                <input className={styles.formInput} value={form.postal_code} onChange={set('postal_code')} placeholder="1634" />
              </div>
            </div>

            {saveError && <p className={styles.saveError}>{saveError}</p>}

            <div className={styles.modalActions}>
              <button className={styles.saveBtn} onClick={handleSave} disabled={isSaving} type="button">
                {isSaving ? 'Saving…' : 'Save changes'}
              </button>
              <button className={styles.cancelBtn} onClick={closeModal} disabled={isSaving} type="button">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
