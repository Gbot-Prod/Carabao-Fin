import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";

const authClient = createAuthClient({
  plugins: [adminClient()],
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

    // Better Auth silently "succeeds" for existing verified emails (anti-enumeration).
    // Detect it by checking if the returned user is already verified.
    if (data.user.emailVerified) {
      throw new Error("An account with this email already exists. Please sign in instead.");
    }

    // Backend sync happens in /email-verified after the user verifies their email.
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
