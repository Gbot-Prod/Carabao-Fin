import type { Metadata } from "next";
import { connection } from "next/server";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import IdleLogout from "@/components/IdleLogout/IdleLogout";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-plus-jakarta-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Carabao",
  description: "Carabao web application",
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