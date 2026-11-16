'use client'

// CH2: the user's own support conversation with the admins.
// Not rendered on the profile page for now; import it back into page.tsx to re-enable.

import { useState } from 'react';
import styles from '../page.module.css';
import OrderChat from '@/components/OrderChat/OrderChat';
import { useLanguage } from '@/lib/i18n/LanguageProvider';

export default function SupportPanel() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.settingCard}>
      <button
        type="button"
        className={styles.settingHeader}
        style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', textAlign: 'left' }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={styles.settingLabel}>💬 {t.support.setting}</span>
      </button>
      {open && (
        <div className={styles.settingDetails}>
          <OrderChat endpoint="/support/messages" title={t.support.title} emptyText={t.support.empty} />
        </div>
      )}
    </div>
  );
}
