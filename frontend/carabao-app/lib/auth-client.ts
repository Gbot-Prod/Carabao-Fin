// Client-side auth helpers using direct HTTP calls
const BASE_URL = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/auth`;

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

    return response.json();
  },
};

export const signUp = {
  email: async (data: {
    email: string;
    password: string;
    name: string;
  }) => {
    const response = await fetch(`${BASE_URL}/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error("Signup failed");
    }

    return response.json();
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

  return response.json();
};
