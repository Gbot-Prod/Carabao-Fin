import 'mapbox-gl/dist/mapbox-gl.css';
import Sidebar from "@/components/sidebar/sidebar";
import { AuthPromptProvider } from "@/components/AuthPrompt/AuthPromptContext";
import { NotificationsProvider } from "@/components/Notifications/NotificationsProvider";
import { BuyerChatsProvider } from "@/components/Chats/BuyerChatsProvider";
import React from 'react';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthPromptProvider>
      <NotificationsProvider>
        <BuyerChatsProvider>
          <div className="app-shell">
            <Sidebar />
            <main className="app-shell__content">
              {/* No Suspense here: it flushed a 200 before a page could call
                  notFound() (farm pages need a real 404). Pages that use
                  useSearchParams wrap themselves, e.g. chats/page.tsx. */}
              {children}
            </main>
          </div>
        </BuyerChatsProvider>
      </NotificationsProvider>
    </AuthPromptProvider>
  );
}
