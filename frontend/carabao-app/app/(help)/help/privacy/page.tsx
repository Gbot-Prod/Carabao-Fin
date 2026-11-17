import styles from '../page.module.css';
import PrivacyPolicyPanel from '../components/PrivacyPolicyPanel';

export const metadata = { title: 'Privacy Policy · Carabao' };

export default function HelpPrivacyPage() {
  return (
    <>
      <h3 id="help-section-title" className={styles.contentTitle}>Privacy Policy</h3>
      <PrivacyPolicyPanel />
    </>
  );
}
