import styles from './page.module.css';

export default function Profile() {
  return (
    <div className={styles.container}>
      {/* Main content */}
      <main className={styles.main}>
        
        {/* Profile Section */}
        <section className={styles.profileSection}>
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

        {/* Order History */}
        <section className={styles.ordersSection}>
          <h3>Order History</h3>
          <div className={styles.ordersList}>
            <div className={styles.orderItem}>
              <div>
                <p className={`${styles.listItem} ${styles.orderFarm}`}>Farm Name</p>
                <p className={styles.orderDate}>Feb 1, 2026</p>
              </div>
              <span className={styles.orderStatus}>Delivered</span>
            </div>
            <div className={styles.orderItem}>
              <div>
                <p className={styles.orderFarm}>Another Farm</p>
                <p className={styles.orderDate}>Jan 28, 2026</p>
              </div>
              <span className={styles.orderStatus}>Delivered</span>
            </div>
          </div>
        </section>

        {/* Logout */}
        <section className={styles.logoutSection}>
          <button className={styles.logoutBtn}>Logout</button>
        </section>

      </main>
    </div>
  );
}