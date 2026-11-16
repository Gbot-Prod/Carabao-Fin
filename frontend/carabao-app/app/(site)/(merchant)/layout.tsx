import "mapbox-gl/dist/mapbox-gl.css";
import { AuthPromptProvider } from "@/components/AuthPrompt/AuthPromptContext";

// merchant.<root> (or /merchant/* on one host). It has no buyer sidebar:
// the pages under (shell) get MerchantShell, and onboarding has its own frame.
export default function MerchantRootLayout({ children }: { children: React.ReactNode }) {
  return <AuthPromptProvider>{children}</AuthPromptProvider>;
}
