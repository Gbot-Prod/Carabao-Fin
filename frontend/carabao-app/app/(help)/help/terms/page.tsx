import styles from '../page.module.css';
import TermsOfServicePanel from '../components/TermsOfServicePanel';

export const metadata = { title: 'Terms of Service · Carabao' };

export default function HelpTermsPage() {
  return (
    <>
      <h3 id="help-section-title" className={styles.contentTitle}>Terms of Service</h3>
      <TermsOfServicePanel />
    </>
  );
}
