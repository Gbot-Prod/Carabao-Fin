import type { Metadata } from "next";
import { ClerkProvider, Show } from "@clerk/nextjs";
import Sidebar from "@/components/sidebar/sidebar";
import "./globals.css";
import Landing from "./landing/page";

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
    <ClerkProvider>
      <html lang="en">
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800&display=swap" rel="stylesheet" />
        </head>
        <body>
          <Show when="signed-in">
            <div className="app-shell">
              <Sidebar />
              <main className="app-shell__content">{children}</main>
            </div>
          </Show>
          <Show when="signed-out">
            <div className="app-shell">
              <main className="app-shell__content"><Landing/></main>
            </div>
          </Show>
        </body>
      </html>
    </ClerkProvider>
  );
}