import styles from '../page.module.css';
import { FAQ_GROUPS } from '../faqs';
import OpenFaqOnHash from './OpenFaqOnHash';

// Static FAQ. Uses native <details> so it's keyboard-accessible with no state.
// Each item has an id so the header search can link to it (/#<id>).
export default function FaqPanel() {
  return (
    <div className={styles.faqGroups}>
      <OpenFaqOnHash />
      {FAQ_GROUPS.map((group) => (
        <div key={group.heading} className={styles.faqGroup}>
          <h4 className={styles.faqHeading}>{group.heading}</h4>
          {group.items.map((item) => (
            <details key={item.id} id={item.id} className={styles.faqItem}>
              <summary className={styles.faqQuestion}>{item.q}</summary>
              <div className={styles.faqAnswer}>{item.a}</div>
            </details>
          ))}
        </div>
      ))}
    </div>
  );
}
