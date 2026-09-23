"use client";

import styles from "./TermsModal.module.css";

interface Props {
  onClose: () => void;
  onAgree: () => void;
}

export default function TermsModal({ onClose, onAgree }: Props) {
  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Terms of Service</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          <p className={styles.effective}>Effective date: May 21, 2026</p>

          <h3>1. About Carabao</h3>
          <p>
            Carabao is a farm-to-consumer marketplace based in the Philippines that connects local
            farmers and merchants with buyers. By creating an account, you agree to these Terms of
            Service (&quot;Terms&quot;). Please read them carefully before proceeding.
          </p>

          <h3>2. Eligibility</h3>
          <p>
            You must be at least 18 years old and legally capable of entering into a binding
            contract under Philippine law to use Carabao. By registering, you confirm that the
            information you provide is accurate and complete.
          </p>

          <h3>3. Account Responsibilities</h3>
          <p>You are responsible for:</p>
          <ul>
            <li>Keeping your password confidential and not sharing access with others.</li>
            <li>All activity that occurs under your account.</li>
            <li>Notifying us immediately at support@carabao.ph if you suspect unauthorized access.</li>
          </ul>

          <h3>4. Buyer Conduct</h3>
          <p>As a buyer, you agree to:</p>
          <ul>
            <li>Provide accurate delivery addresses and contact details.</li>
            <li>Complete payment for orders you place.</li>
            <li>Treat merchants and delivery personnel with respect.</li>
            <li>Not exploit the platform for fraudulent chargebacks or disputes.</li>
          </ul>

          <h3>5. Merchant Conduct</h3>
          <p>Merchants registered on Carabao agree to:</p>
          <ul>
            <li>List only products they are legally authorized to sell.</li>
            <li>Accurately represent product quality, quantity, and pricing.</li>
            <li>Fulfill confirmed orders in a timely manner.</li>
            <li>Comply with Philippine food safety and consumer protection laws.</li>
          </ul>

          <h3>6. Payments</h3>
          <p>
            Payments are processed through PayMongo, a licensed payment processor in the
            Philippines. By completing a purchase, you agree to PayMongo&apos;s terms as well.
            Carabao is not responsible for payment failures caused by your bank or card issuer.
          </p>

          <h3>7. Order Disputes & Refunds</h3>
          <p>
            If you receive an incorrect or damaged order, contact support within 24 hours of
            delivery with photo evidence. Carabao will mediate between buyer and merchant.
            Refunds, where applicable, are processed within 5–10 business days.
          </p>

          <h3>8. Prohibited Activities</h3>
          <p>You may not use Carabao to:</p>
          <ul>
            <li>List or sell illegal, counterfeit, or prohibited goods.</li>
            <li>Harass, threaten, or defraud other users.</li>
            <li>Attempt to reverse-engineer or compromise the platform.</li>
            <li>Create multiple accounts to manipulate ratings or promotions.</li>
          </ul>

          <h3>9. Privacy</h3>
          <p>
            We collect and use your personal information in accordance with our Privacy Policy.
            Your data is stored securely and is not sold to third parties. By using the platform,
            you consent to the collection of data necessary to operate the service.
          </p>

          <h3>10. Limitation of Liability</h3>
          <p>
            Carabao acts as an intermediary marketplace. We are not liable for the quality or
            safety of produce sold by merchants, delivery delays caused by force majeure, or losses
            arising from your misuse of the platform. Our total liability to you shall not exceed
            the amount you paid for the specific order in question.
          </p>

          <h3>11. Changes to These Terms</h3>
          <p>
            We may update these Terms from time to time. Continued use of Carabao after changes
            are posted constitutes your acceptance of the revised Terms. We will notify registered
            users of material changes via email.
          </p>

          <h3>12. Governing Law</h3>
          <p>
            These Terms are governed by the laws of the Republic of the Philippines. Any disputes
            shall be resolved in the courts of competent jurisdiction in Metro Manila.
          </p>
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.closeTextBtn} onClick={onClose}>
            Close
          </button>
          <button type="button" className={styles.agreeBtn} onClick={onAgree}>
            I Agree
          </button>
        </div>
      </div>
    </div>
  );
}
