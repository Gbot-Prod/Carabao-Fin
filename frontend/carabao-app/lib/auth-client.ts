// Client-side auth helpers call same-origin Next.js auth routes.
const BASE_URL = "/api/auth";

const syncBackendSession = async () => {
  const response = await fetch("/api/auth", {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to sync backend session");
  }

  return response.json();
};

export const signIn = {
  email: async (credentials: { email: string; password: string }) => {
    const response = await fetch(`${BASE_URL}/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(credentials),
    });

    if (!response.ok) {
      throw new Error("Login failed");
    }

    const data = await response.json();
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
    const response = await fetch(`${BASE_URL}/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(userData),
    });

    if (!response.ok) {
      throw new Error("Signup failed");
    }

    const data = await response.json();
    await syncBackendSession();
    return data;
  },
};

export const signOut = async () => {
  const response = await fetch(`${BASE_URL}/sign-out`, {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Logout failed");
  }

  await fetch("/api/auth/backend-token", {
    method: "DELETE",
    credentials: "include",
  });

  return response.json();
};
