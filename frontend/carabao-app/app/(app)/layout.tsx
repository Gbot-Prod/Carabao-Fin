import Sidebar from "@/components/sidebar/sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-shell__content">{children}</main>
    </div>
  );
}