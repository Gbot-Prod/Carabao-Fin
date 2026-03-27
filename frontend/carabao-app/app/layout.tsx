import type { Metadata } from "next";
import { ClerkProvider, Show } from "@clerk/nextjs";
import "./globals.css";
import Landing from "./(standalone)/landing/page";

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
            {children}
          </Show>
          <Show when="signed-out">
            <Landing />
          </Show>
        </body>
      </html>
    </ClerkProvider>
  );
}