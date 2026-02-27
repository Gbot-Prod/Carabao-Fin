import type { Metadata } from "next";
import Sidebar from "@/components/sidebar/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Carabao",
  description: "Carabao web application",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <div className="app-shell">
          <Sidebar />
          <main className="app-shell__content">{children}</main>
        </div>
      </body>
    </html>
  );
}