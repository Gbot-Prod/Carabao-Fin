"use client";

import { createContext, useContext, useState } from "react";
import AuthPrompt from "./AuthPrompt";

type AuthPromptContextType = {
  showPrompt: () => void;
};

const AuthPromptContext = createContext<AuthPromptContextType>({ showPrompt: () => {} });

export function AuthPromptProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);

  return (
    <AuthPromptContext.Provider value={{ showPrompt: () => setVisible(true) }}>
      {children}
      {visible && <AuthPrompt onDismiss={() => setVisible(false)} />}
    </AuthPromptContext.Provider>
  );
}

export function useAuthPrompt() {
  return useContext(AuthPromptContext);
}
