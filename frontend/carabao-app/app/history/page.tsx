import styles from './page.module.css';
import ErrorAlert from '../../components/errorTick/errorTick';

function History() {
  return (
    <div className={styles.container}>
      <h1>Order History</h1>
      <p>View your past orders and their details.</p>
      <ErrorAlert type="network-error" isVisible={true} />
      <ErrorAlert type="invalid-date" isVisible={true} />
      <ErrorAlert type="email-used" isVisible={true} />
      <ErrorAlert type="wrong-password" isVisible={true} />
      <ErrorAlert type="required-field" isVisible={true} />
      <ErrorAlert type="invalid-format" isVisible={true} />
      <ErrorAlert type="generic" isVisible={true} />

    </div>
  );
}

export default History;
