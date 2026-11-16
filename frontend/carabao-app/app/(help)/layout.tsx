import type { Metadata } from "next";
import "../globals.css";
import { plusJakartaSans } from "@/lib/fonts";

// Root layout for help (help.<root>, and /help on the main site). Static: no
// sign-in, no API, no database, no CSP nonce (proxy.ts sends a policy without
// one for these pages). The help deploy (APP_SURFACE=help) builds with only
// APP_SURFACE, ROOT_DOMAIN, NEXT_PUBLIC_APP_URL and NEXT_PUBLIC_MAIN_URL.
export const metadata: Metadata = {
  title: "Help · Carabao",
  description: "Carabao help and support",
};

export default function HelpRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={plusJakartaSans.variable}>
      <body>{children}</body>
    </html>
  );
}
