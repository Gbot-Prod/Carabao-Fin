import styles from './page.module.css';
import HelpNav from './components/HelpNav';
import HelpHeader from './components/HelpHeader';

// help.<root>: public pages, no sign-in, no data from the API.
// Layout: green header (logo · search · buyer/farmer sites), then a left
// column (intro + section nav) beside the content card.
export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.container}>
      <HelpHeader />
      <main className={styles.main}>
        <div className={styles.leftCol}>
          <section className={styles.introCard}>
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
