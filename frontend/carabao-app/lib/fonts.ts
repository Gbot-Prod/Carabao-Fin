import { Plus_Jakarta_Sans } from "next/font/google";

// One font for every root layout: app/(site), app/(help) and global-not-found.
export const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-plus-jakarta-sans",
  display: "swap",
});
