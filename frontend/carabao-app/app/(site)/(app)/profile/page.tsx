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
import type { Pin } from '@/util/geocode';
import PageLoader from '@/components/PageLoader/PageLoader';
import TwoFactorSettings from '@/components/TwoFactorSettings/TwoFactorSettings';
import DataExportSection from '@/components/DataExport/DataExportSection';
import { addEmail, updateName } from '@/lib/auth-client';
import { formatPhMobile, normalizePhMobile } from '@/lib/phone';
import FieldError, { focusFirstInvalid, invalidClass, invalidProps, type FieldErrors } from '@/components/FieldError/FieldError';
import PhoneVerifyDialog from '@/components/PhoneVerifyDialog/PhoneVerifyDialog';
import LanguageToggle from '@/components/LanguageToggle/LanguageToggle';
import NotificationsPanel from './components/NotificationsPanel';
import PasswordPanel from './components/PasswordPanel';
import DeleteAccountPanel from './components/DeleteAccountPanel';
import { LogoutButton } from '@/components/LogoutButton';
import { merchantUrl } from '@/lib/urls';
import { Bell, Camera, Check, Lock, LogOut, Mail, MapPin, Plus, Store, User, type LucideIcon } from 'lucide-react';

// Hidden for now — kept as a component in ./components so it can be re-enabled:
//   SupportPanel        (💬 Contact support)  <SupportPanel />

// One card: the left column is an overview and the section menu, the right
// column shows the selected section. The section is kept in the URL hash
// (#addresses), so a link or a reload opens the same one.
const SECTIONS = [
  { id: 'profile', label: 'Profile', Icon: User },
  { id: 'addresses', label: 'Addresses', Icon: MapPin },
  { id: 'notifications', label: 'Notifications', Icon: Bell },
  { id: 'account', label: 'Account', Icon: Lock },
] as const satisfies readonly { id: string; label: string; Icon: LucideIcon }[];

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

const formatMonthYear = (v: string | null | undefined) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short' });
};

const initialsOf = (name: string | null) =>
  (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';

const NoData = ({ text = 'No data' }: { text?: string }) => <em className={styles.noData}>{text}</em>;

// ─── Avatar ───────────────────────────────────────────────────────────────────
function UserAvatar({ pictureUrl, initials, uploading, onUpload }: {
  pictureUrl: string | null;
  initials: string;
  uploading: boolean;
  onUpload: (file: File) => void;
}) {
  return (
    <label className={styles.avatarWrap} title="Change photo">
      <span className={styles.avatarCircle}>
        {uploading ? (
          <span className={styles.avatarSpinner} />
        ) : pictureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pictureUrl} alt="Your profile photo" className={styles.avatar} />
        ) : (
          <span className={styles.avatarInitials} aria-hidden="true">{initials}</span>
        )}
      </span>
      <span className={styles.avatarBadge} aria-hidden="true"><Camera size={12} strokeWidth={2.25} /></span>
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="Change profile photo"
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

type AddressForm = { recipient_name: string; recipient_phone: string; label: string; address: string; barangay: string; city: string; province: string; region: string; postal_code: string };

/** Who the new address is for, until the person changes it: the account's own name and number. */
type Recipient = { name: string; phone: string };

const formFromAddress = (a: UserAddress | null, recipient?: Recipient): AddressForm => ({
  recipient_name: a ? a.recipient_name ?? '' : recipient?.name ?? '',
  recipient_phone: formatPhMobile(a ? a.recipient_phone : recipient?.phone),
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

function AddressPanel({ addresses, recipient, onChanged }: {
  addresses: UserAddress[] | null;
  recipient: Recipient;
  onChanged: () => Promise<void>;
}) {
  // null: list view; 'new': adding; a number: editing that address.
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<'recipient_name' | 'recipient_phone' | 'pin'>>({});
  const [form, setForm] = useState<AddressForm>(() => formFromAddress(null));
  // Map pin for the address (U1b); null until the user drops one.
  const [pin, setPin] = useState<Pin | null>(null);
  // Whether the person placed the pin (false: only where the address geocoded to).
  const [pinConfirmed, setPinConfirmed] = useState(false);

  const startEdit = (a: UserAddress | null) => {
    setError(null);
    setFieldErrors({});
    setForm(formFromAddress(a, recipient));
    setPin(pinFromAddress(a));
    setPinConfirmed(a?.pin_confirmed ?? false);
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
    const phone = normalizePhMobile(form.recipient_phone);
    const errors: FieldErrors<'recipient_name' | 'recipient_phone' | 'pin'> = {};
    if (!form.recipient_name.trim()) errors.recipient_name = 'Enter the name of who receives the delivery.';
    if (!form.recipient_phone.trim()) errors.recipient_phone = 'Enter a mobile number the rider can call.';
    else if (!phone) errors.recipient_phone = 'Enter a PH mobile number, e.g. 0917 123 4567.';
    // Every address needs a pin; a suggested one counts only once confirmed or moved.
    if (!pin) errors.pin = 'Place your pin on the map at your gate or door.';
    else if (!pinConfirmed) errors.pin = 'Move the pin to your gate or door, or tap “This pin is correct”.';
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      requestAnimationFrame(focusFirstInvalid);
      return;
    }
    const payload = {
      recipient_name: clean(form.recipient_name),
      recipient_phone: phone,
      label: clean(form.label),
      region: clean(form.region),
      province: clean(form.province),
      city: clean(form.city),
      barangay: clean(form.barangay),
      address: clean(form.address),
      postal_code: clean(form.postal_code),
      lat: pin && pinConfirmed ? pin.lat : null,
      lng: pin && pinConfirmed ? pin.lng : null,
      pin_confirmed: !!pin && pinConfirmed,
    };
    const id = editing;
    void run(
      () => (id === 'new' || id === null ? createMyAddress(payload) : updateMyAddress(id, payload)),
      'Failed to save. Please try again.',
    );
  };

  const setField = (f: keyof AddressForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(p => ({ ...p, [f]: e.target.value }));
    if (f === 'recipient_name' || f === 'recipient_phone') setFieldErrors(p => ({ ...p, [f]: undefined }));
  };

  if (!addresses) return <PageLoader variant="compact" />;

  if (editing !== null) {
    return (
      <div className={styles.panelForm}>
        <h3 className={styles.formTitle}>{editing === 'new' ? 'New address' : 'Edit address'}</h3>
        <div className={styles.addressForm}>
          <div className={`${styles.panelFormField}${invalidClass(fieldErrors.recipient_name)}`}>
            <label htmlFor="profile-recipient-name" className={styles.formLabel}>Full name</label>
            <input id="profile-recipient-name" className={styles.formInput} value={form.recipient_name} onChange={setField('recipient_name')} placeholder="Juan dela Cruz" autoComplete="name" maxLength={100} {...invalidProps('profile-recipient-name', fieldErrors.recipient_name)} />
            <FieldError id="profile-recipient-name" message={fieldErrors.recipient_name} />
          </div>
          <div className={`${styles.panelFormField}${invalidClass(fieldErrors.recipient_phone)}`}>
            <label htmlFor="profile-recipient-phone" className={styles.formLabel}>Phone number</label>
            <input id="profile-recipient-phone" className={styles.formInput} value={form.recipient_phone} onChange={setField('recipient_phone')} placeholder="0917 123 4567" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} {...invalidProps('profile-recipient-phone', fieldErrors.recipient_phone)} />
            <FieldError id="profile-recipient-phone" message={fieldErrors.recipient_phone} />
          </div>
          <LocationSelects
            value={{ region: form.region, province: form.province, city: form.city, barangay: form.barangay }}
            onChange={(location) => setForm(prev => ({ ...prev, ...location }))}
            selectClassName={styles.formInput}
            labelClassName={styles.formLabel}
            wrapClassName={styles.panelFormField}
          />
          <div className={styles.panelFormField}>
            <label htmlFor="profile-postal-code" className={styles.formLabel}>Postal code</label>
            <input id="profile-postal-code" className={styles.formInput} value={form.postal_code} onChange={setField('postal_code')} placeholder="1634" />
          </div>
          <div className={styles.panelFormField}>
            <label htmlFor="profile-address" className={styles.formLabel}>Street / House No.</label>
            <input id="profile-address" className={styles.formInput} value={form.address} onChange={setField('address')} placeholder="123 Rizal Ave, Unit 4B" />
          </div>
          <div className={`${styles.panelFormField} ${styles.fieldFull}`}>
            <MapPinPicker
              value={pin}
              confirmed={pinConfirmed}
              onChange={(next, confirmed) => {
                setPin(next);
                setPinConfirmed(confirmed);
                if (confirmed) setFieldErrors(p => ({ ...p, pin: undefined }));
              }}
              error={fieldErrors.pin}
              address={{ street: form.address, postalCode: form.postal_code, province: form.province, city: form.city, barangay: form.barangay }}
            />
          </div>
          <div className={`${styles.panelFormField} ${styles.fieldFull}`}>
            <label htmlFor="profile-address-label" className={styles.formLabel}>Label (optional)</label>
            <input id="profile-address-label" className={styles.formInput} value={form.label} onChange={setField('label')} placeholder="Home, Office…" maxLength={50} />
          </div>
        </div>
        {error && <p className={styles.panelError}>{error}</p>}
        <div className={styles.panelActions}>
          <button className={styles.primaryBtn} onClick={save} disabled={busy} type="button">{busy ? 'Saving…' : 'Save address'}</button>
          <button className={styles.cancelBtn} onClick={cancel} disabled={busy} type="button">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.addressPanel}>
      <div className={styles.rowList}>
        {addresses.length === 0 && (
          <div className={styles.emptyRow}>
            <NoData text="No saved addresses yet." />
          </div>
        )}
        {addresses.map((a) => {
          const savedPin = pinFromAddress(a);
          return (
            <div key={a.id} className={styles.addressRow}>
              <span className={styles.rowIcon} aria-hidden="true"><MapPin size={20} strokeWidth={2} /></span>
              <div className={styles.addressText}>
                <div className={styles.addressHead}>
                  <span className={styles.addressLabel}>{a.label || 'Address'}</span>
                  {a.is_default && <span className={styles.badgeOk}><Check size={12} strokeWidth={3} aria-hidden="true" />Default</span>}
                </div>
                {(a.recipient_name || a.recipient_phone) && (
                  <span className={styles.addressLine}>
                    {[a.recipient_name, formatPhMobile(a.recipient_phone)].filter(Boolean).join(' · ')}
                  </span>
                )}
                <span className={styles.addressLine}>{addressLine(a) || <NoData />}</span>
                <span className={styles.addressMeta}>
                  {savedPin ? `Pin: ${savedPin.lat.toFixed(5)}, ${savedPin.lng.toFixed(5)}` : 'Not pinned on the map'}
                </span>
              </div>
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
      </div>
      {error && <p className={styles.panelError}>{error}</p>}
      <div className={styles.panelActions}>
        {addresses.length < MAX_ADDRESSES ? (
          <button className={styles.outlineBtn} onClick={() => startEdit(null)} disabled={busy} type="button">
            <Plus size={16} strokeWidth={2.25} aria-hidden="true" />
            Add address
          </button>
        ) : (
          <p className={styles.panelHint}>You can save up to {MAX_ADDRESSES} addresses.</p>
        )}
      </div>
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

function SubsectionHead({ title, desc, danger = false }: { title: string; desc: string; danger?: boolean }) {
  return (
    <header className={styles.subsectionHead}>
      <h3 className={`${styles.subsectionTitle} ${danger ? styles.dangerTitle : ''}`}>{title}</h3>
      <p className={styles.subsectionDesc}>{desc}</p>
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
  const memberSince = formatDate(profile?.created_at);
  const memberSinceShort = formatMonthYear(profile?.created_at);
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
              initials={initialsOf(fullName)}
              uploading={avatarUploading}
              onUpload={(file) => void handleAvatarUpload(file)}
            />
            <div className={styles.overviewText}>
              <p className={styles.name}>{fullName ?? '—'}</p>
              {memberSinceShort && <p className={styles.overviewMeta}>Member since {memberSinceShort}</p>}
            </div>
          </div>
          {avatarError && <p role="alert" className={styles.panelError}>{avatarError}</p>}

          <nav className={styles.nav} aria-label="Profile sections">
            {SECTIONS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                className={`${styles.navItem} ${section === id ? styles.navItemActive : ''}`}
                aria-current={section === id ? 'page' : undefined}
                onClick={() => openSection(id)}
              >
                <Icon size={18} strokeWidth={2} aria-hidden="true" />
                {label}
              </button>
            ))}
          </nav>

          <div className={styles.sidebarFooter}>
            <LogoutButton className={styles.signOut}>
              <LogOut size={18} strokeWidth={2} aria-hidden="true" />
              <span>Sign out</span>
            </LogoutButton>
          </div>
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
                  <dd className={styles.detailAction}>
                    <button className={styles.linkBtn} onClick={openModal} disabled={!!loadError} type="button">Edit</button>
                  </dd>
                </div>
                <div className={styles.detailRow}>
                  <dt className={styles.detailLabel}>Email</dt>
                  <dd className={styles.detailValue}>
                    <span className={styles.detailText}>{profile?.email ?? <NoData text="Not added yet" />}</span>
                    {profile?.email && (
                      <span className={profile.email_verified ? styles.badgeOk : styles.badgeWarn}>
                        {profile.email_verified && <Check size={12} strokeWidth={3} aria-hidden="true" />}
                        {profile.email_verified ? 'Verified' : 'Not verified'}
                      </span>
                    )}
                  </dd>
                  <dd className={styles.detailAction}>
                    <button className={styles.linkBtn} onClick={openModal} disabled={!!loadError} type="button">
                      {profile?.email ? 'Change' : 'Add'}
                    </button>
                  </dd>
                </div>
                <div className={styles.detailRow}>
                  <dt className={styles.detailLabel}>Mobile</dt>
                  <dd className={styles.detailValue}>
                    <span className={styles.detailText}>{phone ?? <NoData text="Not added yet" />}</span>
                    {profile?.phone_number && (
                      <span className={profile.phone_verified ? styles.badgeOk : styles.badgeWarn}>
                        {profile.phone_verified && <Check size={12} strokeWidth={3} aria-hidden="true" />}
                        {profile.phone_verified ? 'Verified' : 'Not verified'}
                      </span>
                    )}
                  </dd>
                  <dd className={styles.detailAction}>
                    <button className={styles.linkBtn} onClick={() => setPhoneDialogOpen(true)} disabled={!!loadError} type="button">
                      {profile?.phone_verified ? 'Change' : profile?.phone_number ? 'Verify' : 'Add'}
                    </button>
                  </dd>
                </div>
                <div className={styles.detailRow}>
                  <dt className={styles.detailLabel}>Member since</dt>
                  <dd className={styles.detailValue}>{memberSince ?? <NoData />}</dd>
                </div>
              </dl>

              {profile && !profile.email && !loadError && (
                <div className={styles.callout}>
                  <span className={styles.calloutIcon} aria-hidden="true"><Mail size={18} strokeWidth={2} /></span>
                  <div className={styles.calloutText}>
                    <p className={styles.calloutTitle}>Add an email to finish your profile</p>
                    <p className={styles.calloutDesc}>
                      We&apos;ll send order receipts there, and it&apos;s a backup way to recover your account if you lose your number.
                    </p>
                  </div>
                  <button className={styles.darkBtn} onClick={openModal} type="button">Add email</button>
                </div>
              )}

              {hasMerchant && (
                <div className={styles.subsection}>
                  <SubsectionHead title="Selling" desc="The store linked to this account." />
                  <div className={styles.storeRow}>
                    <span className={styles.storeIcon} aria-hidden="true"><Store size={20} strokeWidth={2} /></span>
                    <div className={styles.storeText}>
                      <span className={styles.storeLabel}>Your store</span>
                      <span className={styles.storeName} title={profile?.merchant?.merchant_name ?? undefined}>
                        {profile?.merchant?.merchant_name}
                      </span>
                    </div>
                    <a className={styles.outlineBtn} href={merchantUrl('/')}>Manage store</a>
                  </div>
                </div>
              )}
            </section>
          )}

          {section === 'addresses' && (
            <section>
              <SectionHead title="Addresses" desc="Where we deliver your orders. The default address is used at checkout." />
              <AddressPanel
                addresses={profile?.addresses ?? null}
                recipient={{ name: profile?.name?.trim() ?? '', phone: profile?.phone_number ?? '' }}
                onChanged={async () => {
                  const addresses = await fetchMyAddresses();
                  setProfile(p => (p ? { ...p, addresses } : p));
                }}
              />
            </section>
          )}

          {section === 'notifications' && (
            <section>
              <SectionHead title="Notifications" desc="Choose the messages we send you." />
              <NotificationsPanel profile={profile} onSaved={setProfile} />
            </section>
          )}

          {section === 'account' && (
            <section className={styles.accountSection}>
              <SectionHead title="Account" desc="Your language, your password and your account's security." />

              <div className={styles.subsection}>
                <SubsectionHead title="Language" desc="The language of the app. We save it on this device." />
                <div className={styles.rowList}>
                  <div className={styles.notifRow}>
                    <div className={styles.notifText}>
                      <span className={styles.notifLabel}>App language</span>
                      <span className={styles.notifDesc}>English or Filipino</span>
                    </div>
                    <LanguageToggle />
                  </div>
                </div>
              </div>

              <div className={styles.subsection}>
                <SubsectionHead title="Password" desc="How you log in with your number or email." />
                <PasswordPanel />
              </div>

              {/* Two-step verification (E8a): admins only, and required for them (CF-0003).
                  Status only: setup is on /two-factor/enrol with the link's token (CF-0018). */}
              {profile?.is_admin && (
                <div className={`${styles.subsection} ${styles.twoFactorWrap}`}>
                  <TwoFactorSettings />
                </div>
              )}

              {/* CF-0069: download my data. */}
              <div className={styles.subsection}>
                <DataExportSection />
              </div>

              <div className={styles.subsection}>
                <SubsectionHead title="Delete account" desc="Remove your account and all of its data." danger />
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
