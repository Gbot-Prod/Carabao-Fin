import styles from './header.module.css';
import Link from 'next/link';

function Header() {
  return (
    <div className={styles.headerContainer}>
      {/* Navigation */}
      <nav className={styles.nav}>
        <div className={styles.navLeft}>
          <h1 className={styles.logo}>Carabao</h1>
        </div>
        <div className={styles.navRight}>
          <Link className={styles.link} href="/profile">
            <span className={styles.user}>👤</span>
          </Link>
          <Link className={styles.link} href="/track">
            <span className={styles.track}>🚚</span>
          </Link>
          <Link className={styles.link} href="/order">
            <span className={styles.cart}>🛒</span>
          </Link>
        </div>
      </nav>

      {/* Address bar */}
      <div className={styles.addressBar}>
        <span className={styles.addressIcon}>📍</span>
        <span className={styles.addressLocation}>Dito</span>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        <button className={styles.tabActive}>🚗 Delivery</button>
      </div>
    </div>
  );
}

export default Header;