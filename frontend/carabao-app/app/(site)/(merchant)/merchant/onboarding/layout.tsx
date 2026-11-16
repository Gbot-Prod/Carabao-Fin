import { appUrl, helpUrl } from "@/lib/urls";
import styles from "./layout.module.css";

// Onboarding is for users who are not merchants yet, so it has no merchant
// shell (MerchantShell needs a merchant profile). It gets a small top bar.
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.frame}>
      <header className={styles.bar}>
        <a className={styles.brand} href={appUrl("/order")}>
          <span className={styles.mark} aria-hidden="true">C</span>
          Carabao <span className={styles.sub}>Merchant</span>
        </a>
        <nav className={styles.links} aria-label="Onboarding">
          <a href={helpUrl("/")}>Help</a>
          <a href={appUrl("/profile")}>Back to profile</a>
        </nav>
      </header>
      {children}
    </div>
  );
}
