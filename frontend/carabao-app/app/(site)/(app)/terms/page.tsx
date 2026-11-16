import Link from 'next/link';
import styles from '@/app/(help)/help/page.module.css';
import TermsOfServicePanel from '@/app/(help)/help/components/TermsOfServicePanel';
import { helpUrl } from '@/lib/urls';

export const metadata = { title: 'Terms of Service · Carabao' };

export default function TermsPage() {
  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <section className={styles.contentCard} aria-labelledby="legal-title">
          <Link href={helpUrl('/')} className={styles.backLink}>← Help &amp; Support</Link>
          <h3 id="legal-title" className={styles.contentTitle}>Terms of Service</h3>
          <TermsOfServicePanel />
        </section>
      </main>
    </div>
  );
}
