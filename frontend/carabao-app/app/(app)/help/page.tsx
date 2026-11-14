'use client'

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import styles from './page.module.css';
import { useAuth } from '@/hooks/useAuth';
import { DEFAULT_HELP_SECTION, HELP_SECTIONS, isHelpSection } from './sections';
import HelpNav from './components/HelpNav';
import FaqPanel from './components/FaqPanel';
import ContactPanel from './components/ContactPanel';
import TermsOfServicePanel from './components/TermsOfServicePanel';
import PrivacyPolicyPanel from './components/PrivacyPolicyPanel';

// Help & Support. Public page: linked from the sidebar footer (everyone) and the profile page.
// Layout mirrors /profile: a narrow nav column on the left, content card on the right.
// useSearchParams is safe here because (app)/layout.tsx wraps children in <Suspense>.

const PANELS = {
  faq: FaqPanel,
  contact: ContactPanel,
  terms: TermsOfServicePanel,
  privacy: PrivacyPolicyPanel,
} as const;

export default function HelpPage() {
  const param = useSearchParams().get('section');
  const active = isHelpSection(param) ? param : DEFAULT_HELP_SECTION;
  const section = HELP_SECTIONS.find((s) => s.id === active)!;
  const Panel = PANELS[active];
  // Guests can't open /profile, so send them back to the shops instead.
  const { isAuthenticated } = useAuth();
  const back = isAuthenticated
    ? { href: '/profile', label: '← Back to profile' }
    : { href: '/order', label: '← Back to shops' };

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <div className={styles.leftCol}>
          <section className={styles.introCard}>
            <Link href={back.href} className={styles.backLink}>{back.label}</Link>
            <h2 className={styles.introTitle}>Help &amp; Support</h2>
            <p className={styles.introText}>Answers to common questions, ways to reach us, and our policies.</p>
          </section>
          <HelpNav active={active} />
        </div>

        <section className={styles.contentCard} aria-labelledby="help-section-title">
          <h3 id="help-section-title" className={styles.contentTitle}>{section.title}</h3>
          <Panel />
        </section>
      </main>
    </div>
  );
}
