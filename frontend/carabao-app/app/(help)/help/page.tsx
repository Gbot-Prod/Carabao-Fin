import styles from './page.module.css';
import FaqPanel from './components/FaqPanel';

export const metadata = { title: 'Help · Carabao' };

export default function HelpPage() {
  return (
    <>
      <h3 id="help-section-title" className={styles.contentTitle}>Frequently asked questions</h3>
      <FaqPanel />
    </>
  );
}
