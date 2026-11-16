import styles from '../page.module.css';
import ContactPanel from '../components/ContactPanel';

export const metadata = { title: 'Contact support · Carabao' };

export default function HelpContactPage() {
  return (
    <>
      <h3 id="help-section-title" className={styles.contentTitle}>Contact support</h3>
      <ContactPanel />
    </>
  );
}
