import type { Metadata } from "next";
import "./globals.css";
import ErrorState from "@/components/ErrorState/ErrorState";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { plusJakartaSans } from "@/lib/fonts";

// Unknown URLs. There are two root layouts (app/(site), app/(help)), so this
// page has its own <html> (experimental.globalNotFound in next.config.ts).
// notFound() inside the site still uses app/(site)/not-found.tsx.
export const metadata: Metadata = { title: "Not found · Carabao" };

export default function GlobalNotFound() {
  return (
    <html lang="en" className={plusJakartaSans.variable}>
      <body>
        <LanguageProvider>
          <ErrorState kind="notFound" />
        </LanguageProvider>
      </body>
    </html>
  );
}
