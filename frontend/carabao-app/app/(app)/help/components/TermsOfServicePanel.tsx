import styles from '../page.module.css';
import TermsOfServiceContent from '@/components/TermsModal/TermsOfServiceContent';

// Same text the user agrees to at sign-up , linked from the sign-up card.
export default function TermsOfServicePanel() {
  return (
    <article className={styles.legal}>
      <TermsOfServiceContent effectiveClassName={styles.legalEffective} />
    </article>
  );
}
