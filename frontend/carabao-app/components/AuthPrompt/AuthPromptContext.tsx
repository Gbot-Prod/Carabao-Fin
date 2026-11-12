"use client";

import { createContext, useContext, useState } from "react";
import AuthPrompt, { type AuthPromptReason } from "./AuthPrompt";

type AuthPromptContextType = {
  showPrompt: (reason?: AuthPromptReason) => void;
};

const AuthPromptContext = createContext<AuthPromptContextType>({ showPrompt: () => {} });

export function AuthPromptProvider({ children }: { children: React.ReactNode }) {
  const [reason, setReason] = useState<AuthPromptReason | null>(null);

  return (
    <AuthPromptContext.Provider value={{ showPrompt: (r = "default") => setReason(r) }}>
      {children}
      {reason && <AuthPrompt reason={reason} onDismiss={() => setReason(null)} />}
    </AuthPromptContext.Provider>
  );
}

export function useAuthPrompt() {
  return useContext(AuthPromptContext);
}
