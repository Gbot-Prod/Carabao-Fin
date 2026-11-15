import Link from 'next/link';
import styles from '../page.module.css';
import { SUPPORT_EMAIL } from '../sections';

// Ways to reach the team. The in-app support chat (profile/components/SupportPanel)
// is currently disabled; when it is re-enabled it can be rendered here instead of
// / alongside the email card.
export default function ContactPanel() {
  return (
    <div className={styles.contactGrid}>
      <div className={styles.contactCard}>
        <span className={styles.contactLabel}>Email</span>
        <a className={styles.contactValue} href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        <p className={styles.contactNote}>For account, payment, and delivery concerns. Include your order number if you have one.</p>
      </div>
      <div className={styles.contactCard}>
        <span className={styles.contactLabel}>About an order</span>
        <Link className={styles.contactValue} href="/orders">Go to my orders</Link>
        <p className={styles.contactNote}>Open the order to see its status and message the merchant directly.</p>
      </div>
      <div className={styles.contactCard}>
        <span className={styles.contactLabel}>Damaged or wrong items</span>
        <p className={styles.contactNote}>Report within 24 hours of delivery with photos so we can mediate with the merchant.</p>
      </div>
    </div>
  );
}
