"use client";

import { ChevronRight } from "lucide-react";
import AuthForm from "@/components/AuthForm/AuthForm";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { MERCHANT_PAGES as P } from "@/lib/merchant-links";
import { appUrl, merchantUrl } from "@/lib/urls";
import { merchantLoginUrl } from "../lib/signIn";
import MerchantTopBar from "../MerchantTopBar";
import StallIllustration from "./StallIllustration";
import styles from "./page.module.css";

/** A URL on this host, made absolute: OAuth returns to it from the apex. */
const absolute = (url: string) => new URL(url, window.location.origin).href;

/**
 * Merchant Centre login (merchant.<root>/login): the merchant frame and the
 * shared AuthForm. The same accounts as the buyer site: a new account goes on
 * to the merchant application (onboarding).
 */
export default function MerchantLoginPage() {
  const { t } = useLanguage();
  const m = t.merchantAuth;
  const year = new Date().getFullYear();

  return (
    <div className={styles.page}>
      <MerchantTopBar />

      <main className={styles.main}>
        <section className={styles.hero}>
          <h1 className={styles.heroTitle}>{m.heroTitle}</h1>
          <p className={styles.heroBody}>{m.heroBody}</p>
          <StallIllustration className={styles.illustration} />
        </section>

        <div className={styles.column}>
          <AuthForm
            signUpHint={m.signUpHint}
            redirectIfSignedIn
            defaultNext={merchantUrl("/")}
            // A full page load, so the merchant pages load the new session's data.
            onSuccess={(mode, next) => window.location.assign(mode === "signup" ? merchantUrl(P.onboarding) : next)}
            socialUrls={(next) => ({
              callbackURL: absolute(next),
              errorCallbackURL: absolute(merchantLoginUrl(next)),
            })}
          />

          <a className={styles.buyerLink} href={appUrl("/")}>
            {m.buyerLink}
            <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
          </a>
        </div>
      </main>

      <footer className={styles.footer}>© {year} Carabao. {m.rights}</footer>
    </div>
  );
}
