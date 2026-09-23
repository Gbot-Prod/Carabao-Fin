import 'mapbox-gl/dist/mapbox-gl.css';
import Sidebar from "@/components/sidebar/sidebar";
import { AuthPromptProvider } from "@/components/AuthPrompt/AuthPromptContext";
import React, { Suspense } from 'react';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthPromptProvider>
      <div className="app-shell">
        <Sidebar />
        <main className="app-shell__content">
          <Suspense fallback={<div />}>
            {children}
          </Suspense>
        </main>
      </div>
    </AuthPromptProvider>
  );
}
