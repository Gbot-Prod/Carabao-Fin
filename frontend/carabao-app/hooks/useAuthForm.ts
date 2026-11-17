"use client";

import { useEffect, useState } from "react";
import { isValidPhone, sendPhoneCode, signIn, signUpWithPhone, socialErrorMessage } from "@/lib/auth-client";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { safeNextPath } from "@/lib/next-path";

export const MIN_PASSWORD = 8;

export type AuthMode = "signin" | "signup";
export type AuthProvider = "google" | "facebook";

type Options = {
  /** Where to go when the URL has no ?next=. */
  defaultNext: string;
  /** Called after a password sign-in or a finished signup. */
  onSuccess: (mode: AuthMode, nextPath: string) => void;
  /**
   * Where Google / Facebook return to. Default: the next path, and /auth on a
   * failure (lib/auth-client.ts signIn.social).
   */
  socialUrls?: (nextPath: string) => { callbackURL: string; errorCallbackURL: string };
};

/**
 * The state and steps of the sign-in / sign-up form. Shared by the buyer page
 * (/auth) and the merchant login page, which differ only in layout.
 *
 * Log in with a mobile number (or a verified email) and password, or with
 * Google / Facebook. Sign up with a mobile number, then a name and password,
 * then the 6-digit code we text: the code creates the account with the number
 * already verified.
 */
export function useAuthForm({ defaultNext, onSuccess, socialUrls }: Options) {
  const { t } = useLanguage();
  const [authMode, setMode] = useState<AuthMode>("signin");
  const [step, setStep] = useState<"phone" | "details" | "code">("phone");
  const [form, setForm] = useState({
    identifier: "",
    phoneNumber: "",
    name: "",
    code: "",
    password: "",
    confirmPassword: "",
  });
  const [rememberMe, setRememberMe] = useState(true);
  const [phoneInvalid, setPhoneInvalid] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<AuthProvider | null>(null);
  const [idleNotice, setIdleNotice] = useState(false);
  // ?next= is where to go after sign-in, e.g. the admin setup link (CF-0018).
  const [nextPath, setNextPath] = useState(defaultNext);

  // "Create an account" links (E4) open the page on sign-up; ?reason=idle (E5)
  // explains an automatic sign-out; ?error= is a failed Google/Facebook sign-in.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    queueMicrotask(() => {
      const next = params.get("next");
      if (next) setNextPath(safeNextPath(next));
      if (params.get("mode") === "signup") setMode("signup");
      if (params.get("reason") === "idle") setIdleNotice(true);
      const socialError = params.get("error");
      if (socialError) setError(socialErrorMessage(socialError));
    });
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.name === "phoneNumber") setPhoneInvalid(false);
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const switchMode = (mode: AuthMode) => {
    setMode(mode);
    setStep("phone");
    setForm((f) => ({ ...f, code: "" }));
    setPhoneInvalid(false);
    setError("");
  };

  const sendCode = async () => {
    setError("");
    setIsLoading(true);
    try {
      await sendPhoneCode(form.phoneNumber);
      setForm((f) => ({ ...f, code: "" }));
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : t.auth.genericError);
    } finally {
      setIsLoading(false);
    }
  };

  const continueWith = async (provider: AuthProvider) => {
    setError("");
    setSocialLoading(provider);
    try {
      const urls = socialUrls?.(nextPath);
      await signIn.social(provider, urls?.callbackURL ?? nextPath, urls?.errorCallbackURL);
      // The browser is on its way to the provider; leave the buttons disabled.
    } catch (err) {
      setError(err instanceof Error ? err.message : t.auth.genericError);
      setSocialLoading(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (authMode === "signup" && step === "phone") {
      if (!isValidPhone(form.phoneNumber)) return setPhoneInvalid(true);
      return setStep("details");
    }
    if (authMode === "signup" && step === "details") {
      if (form.password.length < MIN_PASSWORD) return setError(t.auth.passwordTooShort);
      if (form.password !== form.confirmPassword) return setError(t.auth.passwordMismatch);
      return sendCode();
    }
    if (authMode === "signup" && !/^\d{6}$/.test(form.code.trim())) return setError(t.auth.codeInvalid);

    setIsLoading(true);
    try {
      if (authMode === "signin") {
        const identifier = form.identifier.trim();
        const credentials = { password: form.password, rememberMe };
        const result = identifier.includes("@")
          ? await signIn.email({ email: identifier, ...credentials })
          : await signIn.phone({ phoneNumber: identifier, ...credentials });
        // Two-step verification: the client plugin opens /two-factor (E8b).
        if ("twoFactorRedirect" in result && result.twoFactorRedirect) return;
      } else {
        await signUpWithPhone({
          phoneNumber: form.phoneNumber,
          code: form.code,
          name: form.name,
          password: form.password,
        });
      }
      onSuccess(authMode, nextPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.auth.genericError);
    } finally {
      setIsLoading(false);
    }
  };

  const isSignup = authMode === "signup";
  return {
    authMode,
    isSignup,
    step,
    setStep,
    form,
    handleChange,
    switchMode,
    sendCode,
    continueWith,
    handleSubmit,
    rememberMe,
    setRememberMe,
    phoneInvalid,
    error,
    isLoading,
    socialLoading,
    idleNotice,
    nextPath,
    busy: isLoading || socialLoading !== null,
    showSocial: !isSignup || step === "phone",
  };
}
