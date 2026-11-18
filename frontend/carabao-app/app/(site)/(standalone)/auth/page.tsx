"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import AuthForm from "@/components/AuthForm/AuthForm";
import Logo from "@/public/images/icons/carabaoLogo.png";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import "./page.css";

/**
 * Buyer sign-in / sign-up (/auth): the brand panel and the shared AuthForm.
 * The merchant login page uses the same form and the same accounts.
 */
export default function AuthPage() {
  const router = useRouter();
  const { t } = useLanguage();

  return (
    <div className="auth-page">
      <section className="auth-brand-panel">
        <div className="auth-brand-content">
          <Image src={Logo} alt={t.auth.logoAlt} className="auth-brand-logo" priority />
          <h1>Carabao</h1>
          <p>{t.auth.brandTagline}</p>
        </div>
        <div className="auth-brand-orb auth-brand-orb-one" aria-hidden="true" />
        <div className="auth-brand-orb auth-brand-orb-three" aria-hidden="true" />
        <div className="auth-brand-orb auth-brand-orb-two" aria-hidden="true" />
        <div className="auth-brand-orb auth-brand-orb-four" aria-hidden="true" />
      </section>

      <section className="auth-form-panel">
        <AuthForm
          className="auth-card"
          defaultNext="/"
          onSuccess={(_mode, next) => router.push(next)}
        />
      </section>
    </div>
  );
}
