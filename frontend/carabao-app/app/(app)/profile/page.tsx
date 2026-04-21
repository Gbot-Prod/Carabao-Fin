'use client'

import { useEffect, useState } from 'react';
import styles from './page.module.css';
import { fetchMyProfile } from '@/util/api';
function goToMerchantSignup() {
  window.location.href = '/merchantSignup';
}

type ProfileInfo = {
  fullName: string;
  email: string;
};

type SettingsCategory = {
  id: 'addresses' | 'payment' | 'notifications' | 'preferences';
  label: string;
  icon: string;
  details: string[];
};

const settingsCategories: SettingsCategory[] = [
  {
    id: 'addresses',
    label: 'Addresses',
    icon: '📍',
    details: [
      'Primary Address: 123 Mango Ave, Barangay Greenfields',
      'Secondary Address: Add another saved address',
      'Delivery Notes: Add house instructions placeholder',
    ],
  },
  {
    id: 'payment',
    label: 'Payment Methods',
    icon: '💳',
    details: [
      'Saved Cards: No cards added yet',
      'E-Wallet: Link your preferred wallet placeholder',
      'Default Method: Select your checkout default placeholder',
    ],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: '🔔',
    details: [
      'Order Updates: Receive status changes placeholder',
      'Promotions: Weekly deals and updates placeholder',
      'Email Alerts: Transaction receipt preferences placeholder',
    ],
  },
  {
    id: 'preferences',
    label: 'Preferences',
    icon: '⚙️',
    details: [
      'Language: English (editable placeholder)',
      'Theme: Light mode default placeholder',
      'App Experience: Personalized recommendations placeholder',
    ],
  },
];

export default function Profile() {
  const [openCategoryId, setOpenCategoryId] = useState<SettingsCategory['id'] | null>('addresses');
  const [profile, setProfile] = useState<ProfileInfo>({
    fullName: 'Kobe De la Cruz',
    email: 'lastmamba@gmail.com',
  });

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const data = await fetchMyProfile();
        const fullName = [data.first_name, data.last_name].filter(Boolean).join(' ').trim();
        setProfile({
          fullName: fullName || 'Carabao User',
          email: data.email,
        });
      } catch {
        // Keep fallback profile details when backend is unavailable.
      }
    };

    void loadProfile();
  }, []);

  const toggleCategory = (categoryId: SettingsCategory['id']) => {
    setOpenCategoryId((currentId) => (currentId === categoryId ? null : categoryId));
  };

  return (
    <div className={styles.container}>
      {/* Main content */}
      <main className={styles.main}>
        {/* Profile Section */}
        <section className={styles.profileSection}>
          <div className={styles.profileHeader}>
            <img src="/images/others/kobe.avif" alt="Profile" className={styles.profileImage} />
            <div className={styles.profileInfo}>
              <h2>{profile.fullName}</h2>
              <p className={styles.email}>{profile.email}</p>
              <button className={styles.editBtn}>Edit Profile</button>
            </div>
          </div>
        </section>

        {/* Account Settings */}
        <section className={styles.settingsSection}>
          <h3 className={styles.settingsTitle}>Account Settings</h3>
          <div className={styles.settingsList}>
            {settingsCategories.map((category) => {
              const isOpen = openCategoryId === category.id;

              return (
                <div key={category.id} className={styles.settingCard}>
                  <button
                    className={styles.settingItem}
                    onClick={() => toggleCategory(category.id)}
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`${category.id}-panel`}
                  >
                    <span className={styles.settingLabel}>{category.icon} {category.label}</span>
                    <span className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`}>⌄</span>
                  </button>

                  {isOpen && (
                    <div id={`${category.id}-panel`} className={styles.settingDetails}>
                      {category.details.map((detail) => (
                        <div key={detail} className={styles.placeholderDetail}>
                          {detail}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </main>

      <button className={styles.applyAsMerchantButton} onClick={goToMerchantSignup}>Apply as Merchant</button>
    </div>
  );
}