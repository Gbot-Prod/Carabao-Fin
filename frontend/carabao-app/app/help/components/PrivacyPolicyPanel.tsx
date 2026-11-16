import styles from '../page.module.css';
import { SUPPORT_EMAIL } from '../sections';

// DRAFT privacy policy written from what the app actually collects and which
// processors it uses (PayMongo, Resend, Semaphore, Mapbox). Have it reviewed
// for Data Privacy Act (RA 10173) compliance before relying on it.
// If it grows or is needed at sign-up too, move it to components/ like TermsOfServiceContent.

export const PRIVACY_EFFECTIVE_DATE = 'May 21, 2026';

export default function PrivacyPolicyPanel() {
  return (
    <article className={styles.legal}>
      <p className={styles.legalEffective}>Effective date: {PRIVACY_EFFECTIVE_DATE}</p>

      <h3>1. Who we are</h3>
      <p>
        Carabao is a farm-to-consumer marketplace in the Philippines. We process personal
        information in accordance with the Data Privacy Act of 2012 (Republic Act No. 10173).
      </p>

      <h3>2. Information we collect</h3>
      <ul>
        <li><strong>Account details:</strong> name, email address, phone number, and profile photo.</li>
        <li><strong>Delivery details:</strong> address, barangay, city, province, postal code, and an optional map pin.</li>
        <li><strong>Orders:</strong> items purchased, order history, reviews, and messages with merchants.</li>
        <li><strong>Merchants:</strong> store details and payout information needed to send earnings.</li>
        <li><strong>Technical data:</strong> sign-in sessions and basic logs used to keep the service secure.</li>
      </ul>

      <h3>3. How we use it</h3>
      <ul>
        <li>To create and secure your account, including verification codes.</li>
        <li>To process orders, payments, deliveries, and merchant payouts.</li>
        <li>To send order updates and account notices by email or SMS.</li>
        <li>To handle support requests, disputes, and refunds.</li>
      </ul>

      <h3>4. Who we share it with</h3>
      <p>We do not sell your personal information. We share only what is needed with:</p>
      <ul>
        <li>The merchant fulfilling your order (name, contact number, delivery address).</li>
        <li>PayMongo, to process payments and payouts.</li>
        <li>Email and SMS providers, to deliver notifications and verification codes.</li>
        <li>Mapping providers, to show maps and plan delivery routes.</li>
        <li>Authorities, when required by law.</li>
      </ul>

      <h3>5. Retention</h3>
      <p>
        We keep your information while your account is active. When you delete your account,
        your personal data is removed, except records we must keep for legal, tax, or
        dispute-resolution purposes.
      </p>

      <h3>6. Your rights</h3>
      <p>
        You may access and correct your information from your Profile, delete your account at
        any time, and request a copy of your data or object to its processing by emailing{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. You may also file a complaint
        with the National Privacy Commission.
      </p>

      <h3>7. Changes</h3>
      <p>
        We may update this policy. Material changes will be announced by email to registered users.
      </p>
    </article>
  );
}
