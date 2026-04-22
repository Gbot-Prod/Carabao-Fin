import Sidebar from "@/components/sidebar/sidebar";
import { AuthPromptProvider } from "@/components/AuthPrompt/AuthPromptContext";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthPromptProvider>
      <div className="app-shell">
        <Sidebar />
        <main className="app-shell__content">{children}</main>
      </div>
    </AuthPromptProvider>
  );
}
