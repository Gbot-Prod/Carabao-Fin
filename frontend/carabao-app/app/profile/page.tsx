'use client'

import styles from './page.module.css';
import { ClerkProvider, Show, SignInButton, UserButton } from '@clerk/nextjs'

function goToMerchantSignup() {
  window.location.href = '/merchantSignup';
}

export default function Profile() {
  return (
    <div className={styles.container}>
      {/* Main content */}
      <main className={styles.main}>
        {/* Profile Section */}
        <section className={styles.profileSection}>
          <UserButton />
          <div className={styles.profileHeader}>
            <img src="/images/others/kobe.avif" alt="Profile" className={styles.profileImage} />
            <div className={styles.profileInfo}>
              <h2>Kobe De la Cruz</h2>
              <p className={styles.email}>lastmamba@gmail.com</p>
              <button className={styles.editBtn}>Edit Profile</button>
            </div>
          </div>
        </section>

        {/* Account Settings */}
        <section className={styles.settingsSection}>
          <h3>Account Settings</h3>
          <div className={styles.settingsList}>
            <div className={styles.settingItem}>
              <span>📍 Addresses</span>
              <span>›</span>
            </div>
            <div className={styles.settingItem}>
              <span>💳 Payment Methods</span>
              <span>›</span>
            </div>
            <div className={styles.settingItem}>
              <span>🔔 Notifications</span>
              <span>›</span>
            </div>
            <div className={styles.settingItem}>
              <span>⚙️ Preferences</span>
              <span>›</span>
            </div>
          </div>
        </section>
      </main>

      <button className={styles.applyAsMerchantButton} onClick={goToMerchantSignup}>Apply as Merchant</button>
    </div>
  );
}