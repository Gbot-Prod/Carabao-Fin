import { Suspense } from "react";
import { MerchantProvider } from "../MerchantContext";
import MerchantShell from "../MerchantShell";

// All merchant pages except onboarding. The provider loads the shop data once;
// the shell shows the sign-in and "no merchant profile" gates.
export default function MerchantShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <MerchantProvider>
      <MerchantShell>
        <Suspense fallback={null}>{children}</Suspense>
      </MerchantShell>
    </MerchantProvider>
  );
}
