import { createAuthClient } from "better-auth/react";

const authClient = createAuthClient();

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
    const { data, error } = await authClient.signUp.email(userData);

    if (error || !data) {
      throw new Error(getErrorMessage(error, "Signup failed"));
    }

    await syncBackendSession();
    return data;
  },
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
