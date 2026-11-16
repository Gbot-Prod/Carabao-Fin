import Link from 'next/link';
import styles from '@/app/help/page.module.css';
import PrivacyPolicyPanel from '@/app/help/components/PrivacyPolicyPanel';
import { helpUrl } from '@/lib/urls';

export const metadata = { title: 'Privacy Policy · Carabao' };

export default function PrivacyPage() {
  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <section className={styles.contentCard} aria-labelledby="legal-title">
          <Link href={helpUrl('/')} className={styles.backLink}>← Help &amp; Support</Link>
          <h3 id="legal-title" className={styles.contentTitle}>Privacy Policy</h3>
          <PrivacyPolicyPanel />
        </section>
      </main>
    </div>
  );
}
