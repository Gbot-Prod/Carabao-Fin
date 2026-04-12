import { betterAuth } from "better-auth";

export const auth = betterAuth({
  database: {
    type: "sqlite",
    file: "./auth.db",
  },
  baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  basePath: "/api/auth",
  secret: process.env.BETTER_AUTH_SECRET || "your-secret-key",
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "your-google-client-id",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "your-google-client-secret",
    },
  },
});

export type Session = typeof auth.$Infer.Session;
