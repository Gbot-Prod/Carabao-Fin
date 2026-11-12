'use client'

// Not rendered on the profile page for now. Kept so it can be re-enabled by
// importing it back into page.tsx inside a settingCard.

import { useEffect, useState } from 'react';
import styles from '../page.module.css';
import {
  fetchPaymentMethods, attachPaymentMethod, detachPaymentMethod, tokenizeCard, type SavedCard,
} from '@/util/api';
import PageLoader from '@/components/PageLoader/PageLoader';

const BRAND_LABEL: Record<string, string> = { visa: 'VISA', mastercard: 'MC', jcb: 'JCB', amex: 'AMEX' };
const brandLabel = (brand: string) => BRAND_LABEL[brand.toLowerCase()] ?? brand.toUpperCase();

type CardForm = { card_number: string; exp_month: string; exp_year: string; cvc: string; name: string };
const EMPTY_CARD: CardForm = { card_number: '', exp_month: '', exp_year: '', cvc: '', name: '' };

export default function PaymentPanel({ userEmail }: { userEmail: string | undefined }) {
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [loadingCards, setLoadingCards] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CardForm>(EMPTY_CARD);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPaymentMethods()
      .then(setCards)
      .catch(() => setCards([]))
      .finally(() => setLoadingCards(false));
  }, []);

  const setField = (f: keyof CardForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [f]: e.target.value }));

  // Format card number with spaces every 4 digits
  const handleCardNumber = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 16);
    setForm(p => ({ ...p, card_number: digits.replace(/(.{4})/g, '$1 ').trim() }));
  };

  const handleAdd = async () => {
    setError(null);
    const expMonth = parseInt(form.exp_month, 10);
    const expYear = parseInt(form.exp_year, 10);
    if (!form.card_number || !form.cvc || !form.name || !expMonth || !expYear) {
      setError('Please fill in all card fields.'); return;
    }
    setSaving(true);
    try {
      const pmId = await tokenizeCard({
        card_number: form.card_number,
        exp_month: expMonth,
        exp_year: expYear,
        cvc: form.cvc,
        name: form.name,
        email: userEmail ?? '',
      });
      const saved = await attachPaymentMethod(pmId);
      setCards(prev => [...prev, saved]);
      setForm(EMPTY_CARD);
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add card.');
    } finally { setSaving(false); }
  };

  const handleRemove = async (pmId: string) => {
    setRemoving(pmId);
    try {
      await detachPaymentMethod(pmId);
      setCards(prev => prev.filter(c => c.id !== pmId));
    } catch { setError('Could not remove card. Please try again.'); }
    finally { setRemoving(null); }
  };

  if (loadingCards) return <PageLoader variant="compact" />;

  return (
    <div className={styles.paymentPanel}>
      {cards.length === 0 && !showForm && (
        <p className={styles.panelNote}>No saved cards yet.</p>
      )}

      {cards.map(card => (
        <div key={card.id} className={styles.cardRow}>
          <span className={styles.cardBrand}>{brandLabel(card.brand)}</span>
          <span className={styles.cardNumber}>•••• {card.last4}</span>
          <span className={styles.cardExpiry}>{String(card.exp_month).padStart(2, '0')}/{card.exp_year}</span>
          <button
            className={styles.cardRemoveBtn}
            onClick={() => handleRemove(card.id)}
            disabled={removing === card.id}
            type="button"
          >
            {removing === card.id ? '…' : 'Remove'}
          </button>
        </div>
      ))}

      {showForm ? (
        <div className={styles.panelForm}>
          <div className={styles.panelFormField}>
            <label htmlFor="profile-name" className={styles.formLabel}>Name on card</label>
            <input id="profile-name" className={styles.formInput} value={form.name} onChange={setField('name')} placeholder="Juan dela Cruz" />
          </div>
          <div className={styles.panelFormField}>
            <label htmlFor="profile-card-number" className={styles.formLabel}>Card number</label>
            <input id="profile-card-number" className={styles.formInput} value={form.card_number} onChange={handleCardNumber} placeholder="1234 5678 9012 3456" maxLength={19} inputMode="numeric" />
          </div>
          <div className={styles.panelFormRow}>
            <div className={styles.panelFormField}>
              <label htmlFor="profile-exp-month" className={styles.formLabel}>Exp month</label>
              <input id="profile-exp-month" className={styles.formInput} value={form.exp_month} onChange={setField('exp_month')} placeholder="12" maxLength={2} inputMode="numeric" />
            </div>
            <div className={styles.panelFormField}>
              <label htmlFor="profile-exp-year" className={styles.formLabel}>Exp year</label>
              <input id="profile-exp-year" className={styles.formInput} value={form.exp_year} onChange={setField('exp_year')} placeholder="2028" maxLength={4} inputMode="numeric" />
            </div>
            <div className={styles.panelFormField}>
              <label htmlFor="profile-cvc" className={styles.formLabel}>CVC</label>
              <input id="profile-cvc" className={styles.formInput} value={form.cvc} onChange={setField('cvc')} placeholder="123" maxLength={4} inputMode="numeric" type="password" />
            </div>
          </div>
          {error && <p className={styles.panelError}>{error}</p>}
          <div className={styles.panelActions}>
            <button className={styles.saveBtn} onClick={handleAdd} disabled={saving} type="button">{saving ? 'Saving…' : 'Save card'}</button>
            <button className={styles.cancelBtn} onClick={() => { setShowForm(false); setError(null); setForm(EMPTY_CARD); }} disabled={saving} type="button">Cancel</button>
          </div>
        </div>
      ) : (
        <button className={styles.panelEditBtn} onClick={() => { setError(null); setShowForm(true); }} type="button">
          + Add card
        </button>
      )}

      {error && !showForm && <p className={styles.panelError}>{error}</p>}
    </div>
  );
}
