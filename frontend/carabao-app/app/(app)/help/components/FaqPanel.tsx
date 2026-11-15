import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from '../page.module.css';
import { SUPPORT_EMAIL } from '../sections';

// Static FAQ. Uses native <details> so it's keyboard-accessible with no state.
// Keep answers in sync with the actual flows (checkout, tracking, merchant onboarding).

type Faq = { q: string; a: ReactNode };
type FaqGroup = { heading: string; items: Faq[] };

const FAQ_GROUPS: FaqGroup[] = [
  {
    heading: 'Ordering',
    items: [
      {
        q: 'How do I place an order?',
        a: <>Browse produce on the <Link href="/order">Order</Link> page, add items to your cart, then go to <Link href="/cart">Cart</Link> and check out.</>,
      },
      {
        q: 'Why was my cart split into several payments?',
        a: 'Each farm fulfils its own order, so a cart with items from more than one merchant becomes one order (and one payment) per merchant.',
      },
      {
        q: 'How do I track my order?',
        a: <>Open <Link href="/track">Track</Link> to see active deliveries, or <Link href="/orders">Orders</Link> for your full history and order details.</>,
      },
    ],
  },
  {
    heading: 'Payments & refunds',
    items: [
      {
        q: 'Which payment methods are accepted?',
        a: 'Payments are processed online through PayMongo. The available methods are shown on the PayMongo checkout page.',
      },
      {
        q: 'I cancelled or closed the payment page. Was I charged?',
        a: 'No. If you leave checkout before paying, the pending order is cancelled automatically and you are not charged.',
      },
      {
        q: 'My order arrived damaged or incorrect. What do I do?',
        a: <>Contact support within 24 hours of delivery with photos at <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. Approved refunds are processed within 5–10 business days.</>,
      },
    ],
  },
  {
    heading: 'Account',
    items: [
      {
        q: 'How do I change my delivery address?',
        a: <>Go to <Link href="/profile">Profile</Link> → Addresses → Edit address. Dropping a map pin helps riders find you.</>,
      },
      {
        q: 'How do I delete my account?',
        a: <>On your <Link href="/profile">Profile</Link>, use Delete account in the Danger Zone. This is permanent.</>,
      },
    ],
  },
  {
    heading: 'Selling on Carabao',
    items: [
      {
        q: 'How do I become a merchant?',
        a: <>Apply through <Link href="/merchantOnboarding">Merchant onboarding</Link>. Once approved, you can list produce from the Merchant Dashboard.</>,
      },
      {
        q: 'How do I withdraw my earnings?',
        a: 'Use Cash Out on the Earnings tab of your Merchant Dashboard.',
      },
    ],
  },
];

export default function FaqPanel() {
  return (
    <div className={styles.faqGroups}>
      {FAQ_GROUPS.map((group) => (
        <div key={group.heading} className={styles.faqGroup}>
          <h4 className={styles.faqHeading}>{group.heading}</h4>
          {group.items.map((item) => (
            <details key={item.q} className={styles.faqItem}>
              <summary className={styles.faqQuestion}>{item.q}</summary>
              <div className={styles.faqAnswer}>{item.a}</div>
            </details>
          ))}
        </div>
      ))}
    </div>
  );
}
