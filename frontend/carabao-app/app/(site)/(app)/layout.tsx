import 'mapbox-gl/dist/mapbox-gl.css';
import Sidebar from "@/components/sidebar/sidebar";
import { AuthPromptProvider } from "@/components/AuthPrompt/AuthPromptContext";
import { NotificationsProvider } from "@/components/Notifications/NotificationsProvider";
import React, { Suspense } from 'react';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthPromptProvider>
      <NotificationsProvider>
        <div className="app-shell">
          <Sidebar />
          <main className="app-shell__content">
            <Suspense fallback={<div />}>
              {children}
            </Suspense>
          </main>
        </div>
      </NotificationsProvider>
    </AuthPromptProvider>
  );
}
