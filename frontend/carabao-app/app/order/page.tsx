import styles from './page.module.css';
import FarmCard from './components/farmCard'
import { farms } from './data/farms';

export default function Order() {
  return (
    <div className={styles.container}>
      <section className={styles.section}>
        <h2>Order</h2>
        <div className={styles.farmGrid}>
          {farms.map((farm, index) => (
            <FarmCard key={index} farm={farm} />
          ))}
        </div>
      </section>
    </div>
  );
}
