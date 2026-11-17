import type { Metadata } from "next";
import { connection } from "next/server";
import "../globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import IdleLogout from "@/components/IdleLogout/IdleLogout";
import { plusJakartaSans } from "@/lib/fonts";
import { siteUrl } from "@/lib/seo";

// Root layout of every page except help (app/(help)/layout.tsx).

const siteDescription =
  "Buy fresh vegetables and fruits direct from Filipino farms. Order online and get it delivered.";

export const metadata: Metadata = {
  // Open Graph and canonical URLs must be absolute; Next.js resolves
  // relative ones against this.
  metadataBase: siteUrl,
  title: "Carabao",
  description: siteDescription,
  openGraph: {
    type: "website",
    siteName: "Carabao",
    locale: "en_PH",
    title: "Carabao",
    description: siteDescription,
  },
  twitter: { card: "summary_large_image" },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // CF-0002: render each page per request, so Next.js can put the CSP nonce
  // from proxy.ts on its scripts. A static page would have no nonce.
  await connection();
  return (
    <html lang="en" className={plusJakartaSans.variable}>
      <body>
        <LanguageProvider>
          <AuthProvider>
            {children}
            <IdleLogout />
          </AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}