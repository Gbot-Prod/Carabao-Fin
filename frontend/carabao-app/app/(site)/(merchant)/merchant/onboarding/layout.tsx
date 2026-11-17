import MerchantTopBar from "../MerchantTopBar";
import SignInRequired from "../SignInRequired";
import styles from "./layout.module.css";

// Onboarding is for users who are not merchants yet, so it has no merchant
// shell (MerchantShell needs a merchant profile). It gets the Merchant Centre
// top bar, like the login and welcome pages.
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.frame}>
      <MerchantTopBar />
      <SignInRequired>{children}</SignInRequired>
    </div>
  );
}
