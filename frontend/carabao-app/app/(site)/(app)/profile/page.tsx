'use client'

import { useEffect, useState } from 'react';
import getApiErrorMessage from "@/util/errorHelper";
import styles from './page.module.css';
import {
  createMyAddress,
  deleteMyAddress,
  fetchMyAddresses,
  fetchMyProfile,
  updateMyAddress,
  uploadProfilePicture,
  type UserAddress,
  type UserProfile,
} from '@/util/api';
import LocationSelects from '@/components/LocationSelects/LocationSelects';
import MapPinPicker from '@/components/MapPinPicker/MapPinPicker';
import type { Pin } from '@/util/reverseGeocode';
import PageLoader from '@/components/PageLoader/PageLoader';
import TwoFactorSettings from '@/components/TwoFactorSettings/TwoFactorSettings';
import DataExportSection from '@/components/DataExport/DataExportSection';
import { addEmail, updateName } from '@/lib/auth-client';
import { formatPhMobile } from '@/lib/phone';
import PhoneVerifyDialog from '@/components/PhoneVerifyDialog/PhoneVerifyDialog';
import LanguageToggle from '@/components/LanguageToggle/LanguageToggle';
import NotificationsPanel from './components/NotificationsPanel';
import PasswordPanel from './components/PasswordPanel';
import DeleteAccountPanel from './components/DeleteAccountPanel';

// Hidden for now — kept as a component in ./components so it can be re-enabled:
//   SupportPanel        (💬 Contact support)  <SupportPanel />

// One card: the left column is an overview and the section menu, the right
// column shows the selected section. The section is kept in the URL hash
// (#addresses), so a link or a reload opens the same one.
const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'addresses', label: 'Addresses' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'account', label: 'Account' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

const sectionFromHash = (): SectionId => {
  const hash = window.location.hash.slice(1);
  return SECTIONS.some(s => s.id === hash) ? (hash as SectionId) : 'profile';
};

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
          <button className={styles.primaryBtn} onClick={save} disabled={busy} type="button">{busy ? 'Saving…' : 'Save'}</button>
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
              {a.is_default && <span className={styles.badgeOk}>Default</span>}
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
        <button className={styles.secondaryBtn} onClick={() => startEdit(null)} disabled={busy} type="button">+ Add address</button>
      )}
    </div>
  );
}

// ─── Edit profile form ────────────────────────────────────────────────────────
// Name, email and phone are BetterAuth's: the name saves through its client,
// an email only once its link is opened, a phone once its texted code is entered.
type EditForm = { name: string; email: string };

const profileToForm = (p: UserProfile): EditForm => ({ name: p.name ?? '', email: '' });

function SectionHead({ title, desc }: { title: string; desc: string }) {
  return (
    <header className={styles.sectionHead}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <p className={styles.sectionDesc}>{desc}</p>
    </header>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Profile() {
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [section, setSection] = useState<SectionId>('profile');

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<EditForm>({ name: '', email: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [phoneDialogOpen, setPhoneDialogOpen] = useState(false);

  useEffect(() => {
    fetchMyProfile()
      .then(data => { setProfile(data); setForm(profileToForm(data)); })
      .catch(() => setLoadError('Could not load profile. Please refresh.'))
      .finally(() => setIsLoading(false));
    // Back from the link sent to a newly added email (/email-verified).
    if (new URLSearchParams(window.location.search).get('email') === 'verified') {
      queueMicrotask(() => setNotice('Your email is verified.'));
    }
    queueMicrotask(() => setSection(sectionFromHash()));
    const onHash = () => setSection(sectionFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const openSection = (id: SectionId) => {
    setSection(id);
    history.replaceState(null, '', `#${id}`);
  };

  const reloadProfile = async () => setProfile(await fetchMyProfile());

  const handleAvatarUpload = async (file: File) => {
    setAvatarUploading(true);
    setAvatarError(null);
    try {
      setProfile(await uploadProfilePicture(file));
    } catch (err) {
      // CF-0053: the avatar stays as it was; say why (type, size, upload).
      setAvatarError(getApiErrorMessage(err, "The photo could not be uploaded."));
    } finally {
      setAvatarUploading(false);
    }
  };

  const openModal = () => { if (profile) setForm(profileToForm(profile)); setSaveError(null); setModalOpen(true); };
  const closeModal = () => { setSaveError(null); setModalOpen(false); };

  const handleSave = async () => {
    setIsSaving(true); setSaveError(null);
    try {
      const name = form.name.trim().replace(/\s+/g, ' ');
      if (name && name !== (profile?.name ?? '')) await updateName(name);
      const email = form.email.trim();
      if (email) {
        await addEmail(email);
        setNotice(`We sent a link to ${email}. Open it to add the email to your account.`);
      }
      await reloadProfile();
      setModalOpen(false);
    } catch (err) {
      setSaveError(err instanceof Error && err.message ? err.message : 'Failed to save. Please try again.');
    } finally { setIsSaving(false); }
  };

  const set = (field: keyof EditForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [field]: e.target.value }));

  const fullName = profile ? profile.name?.trim() || 'Carabao User' : null;
  const hasMerchant = !!profile?.merchant?.id;
  const cart = profile?.cart;
  const memberSince = formatDate(profile?.created_at);
  const phone = profile?.phone_number ? formatPhMobile(profile.phone_number) : null;

  if (isLoading) return <PageLoader label="Loading your profile…" />;

  return (
    <div className={styles.container}>
      <div className={styles.card}>

        {/* ── Left: overview and section menu ── */}
        <aside className={styles.sidebar}>
          <div className={styles.overview}>
            <UserAvatar
              pictureUrl={profile?.profile_picture_url ?? null}
              uploading={avatarUploading}
              onUpload={(file) => void handleAvatarUpload(file)}
            />
            {avatarError && <p role="alert" className={styles.panelError}>{avatarError}</p>}
            <p className={styles.name}>{fullName ?? '—'}</p>
            <dl className={styles.overviewList}>
              <div>
                <dt>Email</dt>
                <dd>{profile?.email ?? <NoData text="No email" />}</dd>
              </div>
              <div>
                <dt>Contact</dt>
                <dd>{phone ?? <NoData text="No number" />}</dd>
              </div>
            </dl>
          </div>

          <nav className={styles.nav} aria-label="Profile sections">
            {SECTIONS.map(s => (
              <button
                key={s.id}
                type="button"
                className={`${styles.navItem} ${section === s.id ? styles.navItemActive : ''}`}
                aria-current={section === s.id ? 'page' : undefined}
                onClick={() => openSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* ── Right: the selected section ── */}
        <div className={styles.content}>
          {loadError && <p className={styles.errorBanner}>{loadError}</p>}

          {section === 'profile' && (
            <section>
              <SectionHead title="Profile" desc="Your name and how we contact you." />
              {notice && <p className={styles.noticeBanner} role="status">{notice}</p>}

              <dl className={styles.detailList}>
                <div className={styles.detailRow}>
                  <dt className={styles.detailLabel}>Full name</dt>
                  <dd className={styles.detailValue}>{fullName ?? <NoData />}</dd>
                </div>
                <div className={styles.detailRow}>
                  <dt className={styles.detailLabel}>Email</dt>
                  <dd className={styles.detailValue}>
                    <span className={styles.detailText}>{profile?.email ?? <NoData text="No email added" />}</span>
                    {profile?.email && (
                      <span className={profile.email_verified ? styles.badgeOk : styles.badgeWarn}>
                        {profile.email_verified ? 'Verified' : 'Not verified'}
                      </span>
                    )}
                  </dd>
                </div>
                <div className={styles.detailRow}>
                  <dt className={styles.detailLabel}>Mobile</dt>
                  <dd className={styles.detailValue}>
                    <span className={styles.detailText}>{phone ?? <NoData text="No number added" />}</span>
                    {profile?.phone_number && (
                      <span className={profile.phone_verified ? styles.badgeOk : styles.badgeWarn}>
                        {profile.phone_verified ? 'Verified' : 'Not verified'}
                      </span>
                    )}
                    <button className={styles.linkBtn} onClick={() => setPhoneDialogOpen(true)} disabled={!!loadError} type="button">
                      {profile?.phone_verified ? 'Change' : profile?.phone_number ? 'Verify' : 'Add'}
                    </button>
                  </dd>
                </div>
                <div className={styles.detailRow}>
                  <dt className={styles.detailLabel}>Member since</dt>
                  <dd className={styles.detailValue}>{memberSince ?? <NoData />}</dd>
                </div>
                {hasMerchant && (
                  <div className={styles.detailRow}>
                    <dt className={styles.detailLabel}>Your store</dt>
                    <dd className={styles.detailValue}>{profile?.merchant?.merchant_name}</dd>
                  </div>
                )}
              </dl>

              <div className={styles.stats}>
                <div className={styles.stat}>
                  <strong className={styles.statValue}>{cart?.total_items ?? 0}</strong>
                  <span className={styles.statLabel}>Item{cart?.total_items === 1 ? '' : 's'} in cart</span>
                </div>
                <div className={styles.stat}>
                  <strong className={styles.statValue}>{formatPeso(cart?.total_price ?? 0)}</strong>
                  <span className={styles.statLabel}>Cart total</span>
                </div>
              </div>

              <div className={styles.panelActions}>
                <button className={styles.secondaryBtn} onClick={openModal} disabled={!!loadError} type="button">
                  Edit name or email
                </button>
              </div>
            </section>
          )}

          {section === 'addresses' && (
            <section>
              <SectionHead title="Addresses" desc="Where we deliver your orders. The default address is used at checkout." />
              <AddressPanel
                addresses={profile?.addresses ?? null}
                onChanged={async () => {
                  const addresses = await fetchMyAddresses();
                  setProfile(p => (p ? { ...p, addresses } : p));
                }}
              />
            </section>
          )}

          {section === 'notifications' && (
            <section>
              <SectionHead title="Notifications" desc="How we contact you." />
              <div className={styles.group}>
                <h3 className={styles.groupTitle}>Messages</h3>
                <NotificationsPanel profile={profile} onSaved={setProfile} />
              </div>
            </section>
          )}

          {section === 'account' && (
            <section>
              <SectionHead title="Account" desc="Your language, your password and your account's security." />
              <div className={styles.group}>
                <h3 className={styles.groupTitle}>Language</h3>
                <div className={styles.notifRow}>
                  <div className={styles.notifText}>
                    <span className={styles.notifLabel}>App language</span>
                    <span className={styles.notifDesc}>
                      Saved on this device.
                    </span>
                  </div>
                  <LanguageToggle />
                </div>
              </div>
              <div className={styles.group}>
                <h3 className={styles.groupTitle}>Password</h3>
                <PasswordPanel />
              </div>
              {/* Two-step verification (E8a): admins only, and required for them (CF-0003).
                  Status only: setup is on /two-factor/enrol with the link's token (CF-0018). */}
              {profile?.is_admin && (
                <div className={`${styles.group} ${styles.twoFactorWrap}`}>
                  <TwoFactorSettings />
                </div>
              )}
              {/* CF-0069: download my data. */}
              <div className={styles.group}>
                <DataExportSection />
              </div>
              <div className={styles.group}>
                <h3 className={`${styles.groupTitle} ${styles.dangerTitle}`}>Delete account</h3>
                <DeleteAccountPanel
                  phoneVerified={!!profile?.phone_verified}
                  onAddPhone={() => openSection('profile')}
                />
              </div>
            </section>
          )}
        </div>
      </div>

      {/* ── Edit profile modal ── */}
      {modalOpen && (
        <div className={styles.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className={styles.modalCard} role="dialog" aria-modal="true" aria-labelledby="edit-profile-title">
            <h3 id="edit-profile-title" className={styles.modalTitle}>Edit Profile</h3>
            <div className={styles.formGrid}>
              <div className={`${styles.formGroup} ${styles.formGroupFull}`}>
                <label htmlFor="profile-name" className={styles.formLabel}>Full name</label>
                <input id="profile-name" className={styles.formInput} value={form.name} onChange={set('name')} placeholder="Juan dela Cruz" autoComplete="name" />
              </div>
              <div className={`${styles.formGroup} ${styles.formGroupFull}`}>
                <label htmlFor="profile-email" className={styles.formLabel}>
                  {profile?.email_verified ? 'Change email' : 'Add an email'}
                </label>
                <input
                  id="profile-email"
                  type="email"
                  className={styles.formInput}
                  value={form.email}
                  onChange={set('email')}
                  placeholder={profile?.email ?? 'you@example.com'}
                  autoComplete="email"
                />
                <span className={styles.formHint}>For receipts and resetting your password by email. We&apos;ll send a link to confirm it.</span>
              </div>
            </div>
            {saveError && <p className={styles.panelError}>{saveError}</p>}
            <div className={styles.modalActions}>
              <button className={styles.primaryBtn} onClick={handleSave} disabled={isSaving} type="button">{isSaving ? 'Saving…' : 'Save changes'}</button>
              <button className={styles.cancelBtn} onClick={closeModal} disabled={isSaving} type="button">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {phoneDialogOpen && (
        <PhoneVerifyDialog
          initialNumber={profile?.phone_number}
          onClose={() => setPhoneDialogOpen(false)}
          onVerified={() => {
            setPhoneDialogOpen(false);
            setNotice('Your mobile number is verified.');
            void reloadProfile();
          }}
        />
      )}
    </div>
  );
}
