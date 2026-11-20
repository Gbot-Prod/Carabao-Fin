import Link from 'next/link';
import { appUrl, merchantUrl } from '@/lib/urls';
import type { ReactNode } from 'react';
import { SUPPORT_EMAIL } from './sections';

// FAQ content, shared by the FAQ page and the header search.
// Keep answers in sync with the actual flows (checkout, tracking, merchant onboarding).

// `keywords` is extra text for the header search (answers are JSX, so they
// aren't searched directly).
export type Faq = { id: string; q: string; a: ReactNode; keywords?: string };
export type FaqGroup = { heading: string; items: Faq[] };

export const FAQ_GROUPS: FaqGroup[] = [
  {
    heading: 'Ordering',
    items: [
      {
        id: 'place-order',
        q: 'How do I place an order?',
        keywords: 'buy checkout cart',
        a: <>Browse produce on the <Link href={appUrl("/order")}>Order</Link> page, add items to your cart, then go to <Link href={appUrl("/cart")}>Cart</Link> and check out.</>,
      },
      {
        id: 'split-payments',
        q: 'Why was my cart split into several payments?',
        keywords: 'multiple farms merchants',
        a: 'Each farm fulfils its own order, so a cart with items from more than one merchant becomes one order (and one payment) per merchant.',
      },
      {
        id: 'track-order',
        q: 'How do I track my order?',
        keywords: 'delivery status rider',
        a: <>Open <Link href={appUrl("/track")}>Track</Link> to see active deliveries, or <Link href={appUrl("/orders")}>Orders</Link> for your full history and order details.</>,
      },
    ],
  },
  {
    heading: 'Payments & refunds',
    items: [
      {
        id: 'payment-methods',
        q: 'Which payment methods are accepted?',
        keywords: 'paymongo gcash card pay',
        a: 'Payments are processed online through PayMongo. The available methods are shown on the PayMongo checkout page.',
      },
      {
        id: 'cancelled-payment',
        q: 'I cancelled or closed the payment page. Was I charged?',
        keywords: 'charge cancel',
        a: 'No. If you leave checkout before paying, the pending order is cancelled automatically and you are not charged.',
      },
      {
        id: 'damaged-order',
        q: 'My order arrived damaged or incorrect. What do I do?',
        keywords: 'refund wrong item broken',
        a: <>Contact support within 24 hours of delivery with photos at <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. Approved refunds are processed within 5–10 business days.</>,
      },
    ],
  },
  {
    heading: 'Account',
    items: [
      {
        id: 'change-address',
        q: 'How do I change my delivery address?',
        keywords: 'address map pin location',
        a: <>Go to <Link href={appUrl('/profile')}>Profile</Link> → Addresses → Edit address. Fill in the address first and we place the map pin from it; then drag the pin to your gate so riders find you.</>,
      },
      {
        id: 'delete-account',
        q: 'How do I delete my account?',
        keywords: 'remove close account',
        a: <>On your <Link href={appUrl('/profile')}>Profile</Link>, use Delete account in the Danger Zone. This is permanent.</>,
      },
    ],
  },
  {
    heading: 'Selling on Carabao',
    items: [
      {
        id: 'become-merchant',
        q: 'How do I become a merchant?',
        keywords: 'farmer sell apply onboarding',
        a: <>Apply through <Link href={merchantUrl('/onboarding')}>Merchant onboarding</Link>. Once approved, you can list produce from the Merchant Dashboard.</>,
      },
      {
        id: 'withdraw-earnings',
        q: 'How do I withdraw my earnings?',
        keywords: 'cash out payout farmer money',
        a: 'Use Cash Out on the Earnings tab of your Merchant Dashboard.',
      },
    ],
  },
];
