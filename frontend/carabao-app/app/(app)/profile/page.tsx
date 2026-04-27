'use client'

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './page.module.css';
import {
  fetchMyProfile, updateMyProfile, type UserProfile, type NotificationPrefs,
  fetchPaymentMethods, attachPaymentMethod, detachPaymentMethod, tokenizeCard, type SavedCard,
  deleteMyAccount,
} from '@/util/api';
import LocationSelects from '@/components/LocationSelects/LocationSelects';

// ─── SVG avatar ───────────────────────────────────────────────────────────────
function UserAvatar() {
  return (
    <svg className={styles.avatar} viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="40" cy="40" r="40" fill="#d7e7da" />
      <circle cx="40" cy="30" r="14" fill="#31925d" />
      <path d="M8 76 Q8 54 40 54 Q72 54 72 76" fill="#31925d" />
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const formatDate = (v: string | null | undefined) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
};

const formatPeso = (v: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(v);

const DEFAULT_NOTIF: NotificationPrefs = { order_updates: true, promotions: false, email_alerts: true };

function resolveNotifPrefs(raw: Partial<NotificationPrefs> | null | undefined): NotificationPrefs {
  return { ...DEFAULT_NOTIF, ...raw };
}

// ─── Address panel ────────────────────────────────────────────────────────────
type AddressForm = { address: string; city: string; country: string; postal_code: string };

function AddressPanel({ profile, onSaved }: { profile: UserProfile | null; onSaved: (p: UserProfile) => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<AddressForm>({ address: '', city: '', country: '', postal_code: '' });

  useEffect(() => {
    if (profile) {
      setForm({ address: profile.address ?? '', city: profile.city ?? '', country: profile.country ?? '', postal_code: profile.postal_code ?? '' });
    }
  }, [profile]);

  const startEdit = () => { setError(null); setEditing(true); };
  const cancel = () => { if (profile) setForm({ address: profile.address ?? '', city: profile.city ?? '', country: profile.country ?? '', postal_code: profile.postal_code ?? '' }); setEditing(false); setError(null); };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const updated = await updateMyProfile({ address: form.address.trim() || null, city: form.city.trim() || null, country: form.country.trim() || null, postal_code: form.postal_code.trim() || null });
      onSaved(updated);
      setEditing(false);
    } catch { setError('Failed to save. Please try again.'); }
    finally { setSaving(false); }
  };

  const setField = (f: keyof AddressForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [f]: e.target.value }));

  if (!profile) return <p className={styles.panelNote}>Loading…</p>;

  return editing ? (
    <div className={styles.panelForm}>
      <div className={styles.panelFormField}>
        <label className={styles.formLabel}>Street address</label>
        <input className={styles.formInput} value={form.address} onChange={setField('address')} placeholder="123 Rizal Ave" />
      </div>
      <LocationSelects
        value={form.city}
        onChange={(city) => setForm(p => ({ ...p, city }))}
        selectClassName={styles.formInput}
        labelClassName={styles.formLabel}
        wrapClassName={styles.panelFormField}
      />
      <div className={styles.panelFormRow}>
        <div className={styles.panelFormField}>
          <label className={styles.formLabel}>Postal code</label>
          <input className={styles.formInput} value={form.postal_code} onChange={setField('postal_code')} placeholder="1634" />
        </div>
        <div className={styles.panelFormField}>
          <label className={styles.formLabel}>Country</label>
          <input className={styles.formInput} value={form.country} onChange={setField('country')} placeholder="Philippines" />
        </div>
      </div>
      {error && <p className={styles.panelError}>{error}</p>}
      <div className={styles.panelActions}>
        <button className={styles.saveBtn} onClick={save} disabled={saving} type="button">{saving ? 'Saving…' : 'Save'}</button>
        <button className={styles.cancelBtn} onClick={cancel} disabled={saving} type="button">Cancel</button>
      </div>
    </div>
  ) : (
    <div className={styles.panelView}>
      <div className={styles.panelRows}>
        <div className={styles.panelRow}><span className={styles.panelRowLabel}>Street</span><span className={styles.panelRowValue}>{profile.address ?? <em className={styles.noData}>No data</em>}</span></div>
        <div className={styles.panelRow}><span className={styles.panelRowLabel}>City</span><span className={styles.panelRowValue}>{profile.city ?? <em className={styles.noData}>No data</em>}</span></div>
        <div className={styles.panelRow}><span className={styles.panelRowLabel}>Country</span><span className={styles.panelRowValue}>{profile.country ?? <em className={styles.noData}>No data</em>}</span></div>
        <div className={styles.panelRow}><span className={styles.panelRowLabel}>Postal</span><span className={styles.panelRowValue}>{profile.postal_code ?? <em className={styles.noData}>No data</em>}</span></div>
      </div>
      <button className={styles.panelEditBtn} onClick={startEdit} type="button">Edit address</button>
    </div>
  );
}

// ─── Notifications panel ──────────────────────────────────────────────────────
const NOTIF_ITEMS: { key: keyof NotificationPrefs; label: string; desc: string }[] = [
  { key: 'order_updates', label: 'Order updates', desc: 'Status changes for your active orders' },
  { key: 'promotions', label: 'Promotions', desc: 'Weekly deals and special offers' },
  { key: 'email_alerts', label: 'Email alerts', desc: 'Transaction receipts and account notices' },
];

function NotificationsPanel({ profile, onSaved }: { profile: UserProfile | null; onSaved: (p: UserProfile) => void }) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIF);
  const [saving, setSaving] = useState<keyof NotificationPrefs | null>(null);

  useEffect(() => {
    if (profile) setPrefs(resolveNotifPrefs(profile.notifications_preferences));
  }, [profile]);

  const toggle = async (key: keyof NotificationPrefs) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSaving(key);
    try {
      const updated = await updateMyProfile({ notifications_preferences: next });
      onSaved(updated);
    } catch {
      setPrefs(prefs); // revert on failure
    } finally {
      setSaving(null);
    }
  };

  if (!profile) return <p className={styles.panelNote}>Loading…</p>;

  return (
    <div className={styles.notifList}>
      {NOTIF_ITEMS.map(({ key, label, desc }) => (
        <div key={key} className={styles.notifRow}>
          <div className={styles.notifText}>
            <span className={styles.notifLabel}>{label}</span>
            <span className={styles.notifDesc}>{desc}</span>
          </div>
          <button
            type="button"
            className={`${styles.toggle} ${prefs[key] ? styles.toggleOn : ''}`}
            onClick={() => toggle(key)}
            disabled={saving === key}
            aria-label={`${prefs[key] ? 'Disable' : 'Enable'} ${label}`}
          >
            <span className={styles.toggleThumb} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Card brand icon (text fallback) ─────────────────────────────────────────
const BRAND_LABEL: Record<string, string> = { visa: 'VISA', mastercard: 'MC', jcb: 'JCB', amex: 'AMEX' };
function brandLabel(brand: string) { return BRAND_LABEL[brand.toLowerCase()] ?? brand.toUpperCase(); }

// ─── Payment panel ────────────────────────────────────────────────────────────
type CardForm = { card_number: string; exp_month: string; exp_year: string; cvc: string; name: string };
const EMPTY_CARD: CardForm = { card_number: '', exp_month: '', exp_year: '', cvc: '', name: '' };

function PaymentPanel({ userEmail }: { userEmail: string | undefined }) {
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [loadingCards, setLoadingCards] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CardForm>(EMPTY_CARD);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPaymentMethods()
      .then(setCards)
      .catch(() => setCards([]))
      .finally(() => setLoadingCards(false));
  }, []);

  const setField = (f: keyof CardForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [f]: e.target.value }));

  // Format card number with spaces every 4 digits
  const handleCardNumber = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 16);
    setForm(p => ({ ...p, card_number: digits.replace(/(.{4})/g, '$1 ').trim() }));
  };

  const handleAdd = async () => {
    setError(null);
    const expMonth = parseInt(form.exp_month, 10);
    const expYear = parseInt(form.exp_year, 10);
    if (!form.card_number || !form.cvc || !form.name || !expMonth || !expYear) {
      setError('Please fill in all card fields.'); return;
    }
    setSaving(true);
    try {
      const pmId = await tokenizeCard({
        card_number: form.card_number,
        exp_month: expMonth,
        exp_year: expYear,
        cvc: form.cvc,
        name: form.name,
        email: userEmail ?? '',
      });
      const saved = await attachPaymentMethod(pmId);
      setCards(prev => [...prev, saved]);
      setForm(EMPTY_CARD);
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add card.');
    } finally { setSaving(false); }
  };

  const handleRemove = async (pmId: string) => {
    setRemoving(pmId);
    try {
      await detachPaymentMethod(pmId);
      setCards(prev => prev.filter(c => c.id !== pmId));
    } catch { setError('Could not remove card. Please try again.'); }
    finally { setRemoving(null); }
  };

  if (loadingCards) return <p className={styles.panelNote}>Loading…</p>;

  return (
    <div className={styles.paymentPanel}>
      {cards.length === 0 && !showForm && (
        <p className={styles.panelNote}>No saved cards yet.</p>
      )}

      {cards.map(card => (
        <div key={card.id} className={styles.cardRow}>
          <span className={styles.cardBrand}>{brandLabel(card.brand)}</span>
          <span className={styles.cardNumber}>•••• {card.last4}</span>
          <span className={styles.cardExpiry}>{String(card.exp_month).padStart(2, '0')}/{card.exp_year}</span>
          <button
            className={styles.cardRemoveBtn}
            onClick={() => handleRemove(card.id)}
            disabled={removing === card.id}
            type="button"
          >
            {removing === card.id ? '…' : 'Remove'}
          </button>
        </div>
      ))}

      {showForm ? (
        <div className={styles.panelForm}>
          <div className={styles.panelFormField}>
            <label className={styles.formLabel}>Name on card</label>
            <input className={styles.formInput} value={form.name} onChange={setField('name')} placeholder="Juan dela Cruz" />
          </div>
          <div className={styles.panelFormField}>
            <label className={styles.formLabel}>Card number</label>
            <input className={styles.formInput} value={form.card_number} onChange={handleCardNumber} placeholder="1234 5678 9012 3456" maxLength={19} inputMode="numeric" />
          </div>
          <div className={styles.panelFormRow}>
            <div className={styles.panelFormField}>
              <label className={styles.formLabel}>Exp month</label>
              <input className={styles.formInput} value={form.exp_month} onChange={setField('exp_month')} placeholder="12" maxLength={2} inputMode="numeric" />
            </div>
            <div className={styles.panelFormField}>
              <label className={styles.formLabel}>Exp year</label>
              <input className={styles.formInput} value={form.exp_year} onChange={setField('exp_year')} placeholder="2028" maxLength={4} inputMode="numeric" />
            </div>
            <div className={styles.panelFormField}>
              <label className={styles.formLabel}>CVC</label>
              <input className={styles.formInput} value={form.cvc} onChange={setField('cvc')} placeholder="123" maxLength={4} inputMode="numeric" type="password" />
            </div>
          </div>
          {error && <p className={styles.panelError}>{error}</p>}
          <div className={styles.panelActions}>
            <button className={styles.saveBtn} onClick={handleAdd} disabled={saving} type="button">{saving ? 'Saving…' : 'Save card'}</button>
            <button className={styles.cancelBtn} onClick={() => { setShowForm(false); setError(null); setForm(EMPTY_CARD); }} disabled={saving} type="button">Cancel</button>
          </div>
        </div>
      ) : (
        <button className={styles.panelEditBtn} onClick={() => { setError(null); setShowForm(true); }} type="button">
          + Add card
        </button>
      )}

      {error && !showForm && <p className={styles.panelError}>{error}</p>}
    </div>
  );
}

// ─── Edit form type ───────────────────────────────────────────────────────────
type EditForm = { first_name: string; last_name: string; phone_number: string; address: string; city: string; country: string; postal_code: string };

function profileToForm(p: UserProfile): EditForm {
  return { first_name: p.first_name ?? '', last_name: p.last_name ?? '', phone_number: p.phone_number ?? '', address: p.address ?? '', city: p.city ?? '', country: p.country ?? '', postal_code: p.postal_code ?? '' };
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Profile() {
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<EditForm>({ first_name: '', last_name: '', phone_number: '', address: '', city: '', country: '', postal_code: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true); setLoadError(null);
      try {
        const data = await fetchMyProfile();
        setProfile(data);
        setForm(profileToForm(data));
      } catch {
        setLoadError('Could not load profile. Please refresh.');
      } finally { setIsLoading(false); }
    };
    void load();
  }, []);

  const openModal = () => { if (profile) setForm(profileToForm(profile)); setSaveError(null); setModalOpen(true); };
  const closeModal = () => { setSaveError(null); setModalOpen(false); };

  const handleSave = async () => {
    setIsSaving(true); setSaveError(null);
    try {
      const updated = await updateMyProfile({ first_name: form.first_name.trim() || null, last_name: form.last_name.trim() || null, phone_number: form.phone_number.trim() || null, address: form.address.trim() || null, city: form.city.trim() || null, country: form.country.trim() || null, postal_code: form.postal_code.trim() || null });
      setProfile(updated); setModalOpen(false);
    } catch { setSaveError('Failed to save. Please try again.'); }
    finally { setIsSaving(false); }
  };

  const set = (field: keyof EditForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [field]: e.target.value }));

  const handleDeleteAccount = async () => {
    setDeletingAccount(true);
    try {
      await deleteMyAccount();
      await fetch('/api/auth/backend-token', { method: 'DELETE' });
      window.location.href = '/auth';
    } catch {
      setDeletingAccount(false);
      setConfirmDeleteAccount(false);
    }
  };

  const fullName = profile ? [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim() || 'Carabao User' : null;
  const addressLine = profile ? [profile.address, profile.city, profile.country, profile.postal_code].filter(Boolean).join(', ') : null;
  const hasMerchant = !!profile?.merchant?.id;

  return (
    <div className={styles.container}>
      <main className={styles.main}>

        {/* ── Left column ── */}
        <div className={styles.leftCol}>

          {/* Profile card */}
          <section className={styles.profileSection}>
            <div className={styles.avatarWrap}><UserAvatar /></div>

            <div className={styles.nameBlock}>
              <h2 className={styles.name}>{isLoading ? '—' : (fullName ?? '—')}</h2>
              <p className={styles.email}>{isLoading ? '—' : (profile?.email ?? '—')}</p>
            </div>

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

            <button className={styles.editBtn} onClick={openModal} disabled={isLoading || !!loadError} type="button">
              Edit Profile
            </button>

            {/* 3-card snapshot — auth link removed */}
            <div className={styles.profileSnapshot}>
              <div className={styles.snapshotCard}>
                <span className={styles.snapshotLabel}>Member since</span>
                <strong className={styles.snapshotValue}>{isLoading ? '—' : (formatDate(profile?.created_at) ?? 'No data')}</strong>
              </div>
              <div className={styles.snapshotCard}>
                <span className={styles.snapshotLabel}>Merchant</span>
                <strong className={styles.snapshotValue}>{isLoading ? '—' : (profile?.merchant?.merchant_name ?? 'None')}</strong>
              </div>
              <div className={`${styles.snapshotCard} ${styles.snapshotCardWide}`}>
                <span className={styles.snapshotLabel}>Cart</span>
                <strong className={styles.snapshotValue}>
                  {isLoading ? '—' : profile?.cart ? `${profile.cart.total_items} item${profile.cart.total_items === 1 ? '' : 's'} · ${formatPeso(profile.cart.total_price)}` : 'No data'}
                </strong>
              </div>
            </div>
          </section>

          {/* Merchant actions — anchored below profile card */}
          <section className={styles.merchantSection}>
            {hasMerchant ? (
              <>
                <Link className={styles.merchantBtn} href={`/merchant/${profile!.merchant!.id}`}>View Merchant Page</Link>
                <Link className={styles.merchantBtn} href="/merchantDashboard">Merchant Dashboard</Link>
              </>
            ) : (
              <Link className={`${styles.merchantBtn} ${styles.merchantBtnPrimary}`} href="/merchantOnboarding">
                Apply as Merchant
              </Link>
            )}
          </section>

          {/* Danger zone */}
          <section className={styles.profileDangerZone}>
            <p className={styles.profileDangerLabel}>Danger Zone</p>
            {!confirmDeleteAccount ? (
              <button
                className={styles.profileDangerBtn}
                onClick={() => setConfirmDeleteAccount(true)}
                disabled={isLoading}
                type="button"
              >
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
                <AddressPanel profile={profile} onSaved={setProfile} />
              </div>
            </div>

            <div className={styles.settingCard}>
              <div className={styles.settingHeader}>
                <span className={styles.settingLabel}>💳 Payment Methods</span>
              </div>
              <div className={styles.settingDetails}>
                <PaymentPanel userEmail={profile?.email} />
              </div>
            </div>

            <div className={styles.settingCard}>
              <div className={styles.settingHeader}>
                <span className={styles.settingLabel}>🔔 Notifications</span>
              </div>
              <div className={styles.settingDetails}>
                <NotificationsPanel profile={profile} onSaved={setProfile} />
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
              <LocationSelects
                value={form.city}
                onChange={(city) => setForm(p => ({ ...p, city }))}
                selectClassName={styles.formInput}
                labelClassName={styles.formLabel}
                wrapClassName={styles.formGroup}
              />
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
              <button className={styles.saveBtn} onClick={handleSave} disabled={isSaving} type="button">{isSaving ? 'Saving…' : 'Save changes'}</button>
              <button className={styles.cancelBtn} onClick={closeModal} disabled={isSaving} type="button">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
