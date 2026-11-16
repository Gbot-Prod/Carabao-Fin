import Link from 'next/link';
import styles from './page.module.css';
import HelpNav from './components/HelpNav';
import { appUrl } from '@/lib/urls';

// help.<root>: public pages, no sign-in, no data from the API.
// The pages render per request only because the root layout needs the CSP
// nonce (CF-0002).
export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <div className={styles.leftCol}>
          <section className={styles.introCard}>
            <Link href={appUrl('/order')} className={styles.backLink}>← Back to Carabao</Link>
            <h2 className={styles.introTitle}>Help &amp; Support</h2>
            <p className={styles.introText}>Answers to common questions, ways to reach us, and our policies.</p>
          </section>
          <HelpNav />
        </div>
        <section className={styles.contentCard} aria-labelledby="help-section-title">
          {children}
        </section>
      </main>
    </div>
  );
}
