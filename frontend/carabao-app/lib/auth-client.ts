import { createAuthClient } from "better-auth/react";
import { adminClient, twoFactorClient } from "better-auth/client/plugins";

const authClient = createAuthClient({
  plugins: [
    adminClient(),
    // E8: a sign-in that needs a second factor continues on the code page.
    twoFactorClient({
      onTwoFactorRedirect: () => {
        window.location.href = "/two-factor";
      },
    }),
  ],
});

const syncBackendSession = async () => {
  try {
    const response = await fetch("/api/auth", {
      method: "POST",
      credentials: "include",
    });

    if (!response.ok) {
      console.warn(
        `Backend session sync skipped: /api/auth returned ${response.status}`
      );
      return null;
    }

    return response.json();
  } catch (error) {
    console.warn("Backend session sync skipped: /api/auth request failed", error);
    return null;
  }
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (!error || typeof error !== "object") {
    return fallback;
  }

  const maybeError = error as {
    message?: string;
    statusText?: string;
  };

  return maybeError.message || maybeError.statusText || fallback;
};

export const signIn = {
  email: async (credentials: { email: string; password: string }) => {
    const { data, error } = await authClient.signIn.email(credentials);

    // BetterAuth's admin plugin reports an account an admin suspended as BANNED_USER.
    if (error?.code === "BANNED_USER") {
      throw new Error("This account has been suspended. Contact Carabao support.");
    }
    if (error || !data) {
      throw new Error(getErrorMessage(error, "Login failed"));
    }

    await syncBackendSession();
    return data;
  },
};

export const signUp = {
  email: async (userData: {
    email: string;
    password: string;
    name: string;
  }) => {
    const { data, error } = await authClient.signUp.email({
      ...userData,
      callbackURL: "/email-verified",
    });

    if (error || !data) {
      throw new Error(getErrorMessage(error, "Signup failed"));
    }

    // requireEmailVerification means sign-up never opens a session, and an
    // existing email gets a look-alike success (anti-enumeration). Callers
    // either sign in next (email-OTP signups) or wait for the emailed link,
    // which lands on /email-verified and syncs there.
    return data;
  },
};

export const resendVerificationEmail = async (email: string) => {
  const { data, error } = await authClient.sendVerificationEmail({
    email,
    callbackURL: "/email-verified",
  });

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "EMAIL_ALREADY_VERIFIED") {
      throw new Error("ALREADY_VERIFIED");
    }
    throw new Error(getErrorMessage(error, "Could not resend verification email"));
  }

  return data;
};

export const signOut = async () => {
  const { data, error } = await authClient.signOut();

  if (error || !data) {
    throw new Error(getErrorMessage(error, "Logout failed"));
  }

  await fetch("/api/auth/backend-token", {
    method: "DELETE",
    credentials: "include",
  });

  return data;
};

// Forgot password (E6). BetterAuth answers the same whether or not the email
// has an account, so the page can't be used to discover accounts.
export const requestPasswordReset = async (email: string) => {
  const { error } = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
  if (error) throw new Error(getErrorMessage(error, "Could not send the reset email"));
};

export const resetPassword = async (newPassword: string, token: string) => {
  const { error } = await authClient.resetPassword({ newPassword, token });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "INVALID_TOKEN") throw new Error("INVALID_TOKEN");
    throw new Error(getErrorMessage(error, "Could not reset the password"));
  }
};

// Two-step verification (E8a). Enabling returns the authenticator URI and
// backup codes; the plugin only turns it on after a first code is verified.
export const getTwoFactorEnabled = async (): Promise<boolean> => {
  const { data } = await authClient.getSession();
  return Boolean((data?.user as { twoFactorEnabled?: boolean | null } | undefined)?.twoFactorEnabled);
};

export const enableTwoFactor = async (password: string) => {
  const { data, error } = await authClient.twoFactor.enable({ password });
  if (error || !data) throw new Error(getErrorMessage(error, "Could not start two-step verification"));
  return data;
};

export const verifyTwoFactorSetup = async (code: string) => {
  const { error } = await authClient.twoFactor.verifyTotp({ code });
  if (error) throw new Error(getErrorMessage(error, "That code didn't match. Try the newest code."));
};

export const disableTwoFactor = async (password: string) => {
  const { error } = await authClient.twoFactor.disable({ password });
  if (error) throw new Error(getErrorMessage(error, "Could not turn off two-step verification"));
};
